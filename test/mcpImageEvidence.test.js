import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMcpToolResult, extractMcpText } from "../src/mcp/amosMcpClient.js";
import { takeModelEvidence } from "../src/model/evidence.js";
import { AgentLoop } from "../src/agentLoop.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { OpenAICompatibleClient } from "../src/model/openAiCompatibleClient.js";
import { OpenAIResponsesClient } from "../src/model/openAiResponsesClient.js";
import { AnthropicMessagesClient } from "../src/model/anthropicMessagesClient.js";
import { readFileSync } from "node:fs";

const PNG = process.env.AMOS_RFP_IMAGE_FIXTURE
  ? readFileSync(process.env.AMOS_RFP_IMAGE_FIXTURE).toString("base64")
  : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1kAAAAASUVORK5CYII=";
const metadata = { visual_review_id: "synthetic-page", definition: { kind: "rfp_visual_evidence", page: 1, bytes_sha256: "a".repeat(64) }, result: { segments: [{ id: "ocr:0", text: "Capacity 2200 units", provenance: "machine_ocr_unverified" }] }, image_url: "/api/rfp-review/visual/synthetic-page/image" };
function envelope(images = [{ type: "image", mimeType: "image/png", data: PNG }]) {
  return { structuredContent: structuredClone(metadata), content: [{ type: "text", text: JSON.stringify(metadata) }, ...images] };
}

test("MCP image blocks survive structured results only as non-enumerable model evidence", () => {
  const raw=envelope();
  const result=normalizeMcpToolResult(raw);
  assert.equal(result.ok,true);
  assert.equal(result.definition.page,1);
  assert.ok(!JSON.stringify(result).includes(PNG));
  assert.ok(!extractMcpText(raw).includes(PNG));
  assert.ok(!JSON.stringify(structuredClone(result)).includes(PNG));
  const images=takeModelEvidence(result);
  assert.equal(images[0].image_url.url,`data:image/png;base64,${PNG}`);
  assert.deepEqual(takeModelEvidence(result),[]);
  delete raw.structuredContent;
  assert.equal(normalizeMcpToolResult(raw).visual_review_id,"synthetic-page");
});

test("malformed, oversized, unsupported and excessive MCP images never reach model evidence", () => {
  for (const images of [
    [{type:"image",mimeType:"image/svg+xml",data:PNG}],
    [{type:"image",mimeType:"image/png",data:"not base64"}],
    [{type:"image",mimeType:"image/jpeg",data:PNG}],
    [{type:"image",mimeType:"image/png",data:"a".repeat(4*1024*1024+4)}],
    Array.from({length:5},()=>({type:"image",mimeType:"image/png",data:PNG}))
  ]) {
    const result=normalizeMcpToolResult(envelope(images));
    assert.equal(result.ok,true,"OCR metadata remains usable");
    assert.equal(result.mcp_visual_evidence.status,"rejected");
    assert.deepEqual(takeModelEvidence(result),[]);
    assert.ok(!JSON.stringify(result).includes(PNG));
  }
  const failed=normalizeMcpToolResult({...envelope(),isError:true});
  assert.equal(failed.ok,false);
  assert.deepEqual(takeModelEvidence(failed),[]);
});

async function imageLoop(vision, modelClient, extra={}) {
  const registry=new ToolRegistry();
  registry.register({ name:"read_source_page", readOnly:true, handler:async()=>normalizeMcpToolResult(envelope()) });
  const events=[],stored=[];
  const loop=new AgentLoop({ config:{agent:{},model:{capabilities:{vision}}},registry,amosClient:{},approvals:{},modelClient,
    onToolResult:async result=>{stored.push(JSON.stringify(result));return {result_ref:"synthetic-result"};},...extra });
  const answer=await loop.run("Inspect the source page, preserving OCR uncertainty.",{onEvent:e=>events.push(e)});
  assert.ok(!JSON.stringify(events).includes(PNG));
  assert.ok(!JSON.stringify(stored).includes(PNG));
  assert.ok(!JSON.stringify(loop.messages).includes(PNG),"pixels expire at task completion");
  return {answer,loop,events};
}

test("a text-only model receives an explicit no-visual-review fallback without image bytes", async()=>{
  let turn=0;
  const {events}=await imageLoop(false,{chat:async({messages})=>{
    if(++turn===1)return {message:{role:"assistant",content:"",tool_calls:[{id:"p1",function:{name:"read_source_page",arguments:"{}"}}]}};
    assert.ok(!JSON.stringify(messages).includes(PNG));
    assert.ok(JSON.stringify(messages).includes("not_sent_no_vision"));
    return {message:{role:"assistant",content:"OCR says 2200; visual review still requires a vision model or human."}};
  }});
  assert.equal(events.find(e=>e.type==="tool_end").result.mcp_visual_evidence.status,"not_sent_no_vision");
});

test("combined tool batches have one image budget, not four images per operation", async()=>{
  const registry=new ToolRegistry();
  for(const name of ["page_batch_a","page_batch_b"])registry.register({name,handler:async()=>normalizeMcpToolResult(envelope(Array.from({length:4},()=>({type:"image",mimeType:"image/png",data:PNG}))))});
  let turn=0;
  const loop=new AgentLoop({config:{agent:{},model:{capabilities:{vision:true}}},registry,amosClient:{},approvals:{},modelClient:{chat:async({messages})=>{
    if(++turn===1)return {message:{role:"assistant",content:"",tool_calls:["page_batch_a","page_batch_b"].map((name,i)=>({id:`batch-${i}`,function:{name,arguments:"{}"}}))}};
    const images=messages.filter(m=>m.amosEphemeralEvidence).flatMap(m=>m.content.filter(p=>p.type==="image_url"));
    assert.equal(images.length,4);
    assert.ok(messages.some(m=>m.role==="tool"&&m.content.includes("not_sent_batch_limit")));
    return {message:{role:"assistant",content:"Only the first image batch was supplied. Remaining pages need a separate turn."}};
  }}});
  await loop.run("Inspect the page batches.");
  assert.ok(!JSON.stringify(loop.messages).includes(PNG));
});

test("provider failure releases source pixels rather than carrying them into a resumed task",async()=>{
  const registry=new ToolRegistry();registry.register({name:"read_source_page",handler:async()=>normalizeMcpToolResult(envelope())});
  let turn=0;
  const loop=new AgentLoop({config:{agent:{},model:{capabilities:{vision:true}}},registry,amosClient:{},approvals:{},modelClient:{chat:async()=>{
    if(++turn===1)return {message:{role:"assistant",content:"",tool_calls:[{id:"p1",function:{name:"read_source_page",arguments:"{}"}}]}};
    throw new Error("synthetic permanent provider failure");
  }}});
  await assert.rejects(()=>loop.run("Inspect page."),/synthetic permanent provider failure/);
  assert.ok(!JSON.stringify(loop.messages).includes(PNG));
});

test("intelligence handoff does not forward pixels captured for the previous model",async()=>{
  const registry=new ToolRegistry();let loop;
  const replacement={chat:async({messages})=>{
    assert.ok(!JSON.stringify(messages).includes(PNG));
    assert.ok(JSON.stringify(messages).includes("were not forwarded"));
    return {message:{role:"assistant",content:"The new intelligence needs a fresh source read or human visual review."}};
  }};
  registry.register({name:"read_source_page",handler:async()=>{
    loop.queueHandoff({modelClient:replacement,config:{agent:{},model:{capabilities:{vision:false}}}});
    return normalizeMcpToolResult(envelope());
  }});
  loop=new AgentLoop({config:{agent:{},model:{capabilities:{vision:true}}},registry,amosClient:{},approvals:{},modelClient:{chat:async()=>({message:{role:"assistant",content:"",tool_calls:[{id:"p1",function:{name:"read_source_page",arguments:"{}"}}]}})}});
  await loop.run("Inspect the source page.");
  assert.ok(!JSON.stringify(loop.messages).includes(PNG));
});

for(const protocol of ["chat","responses","anthropic"]) test(`MCP source images reach the real ${protocol} request adapter, not its tool-output text`,async()=>{
  const bodies=[];
  const modelConfig={baseUrl:"https://fixture.invalid/v1",model:"synthetic-vision",apiKey:"synthetic-key",requestTimeoutMs:1000,capabilities:{tools:true,vision:true,reasoning:false}};
  const fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);
    const first=bodies.length===1;
    if(!first){
      const all=JSON.stringify(body);
      assert.ok(all.includes(PNG),"the second provider request contains the source image");
      if(protocol==="chat")assert.ok(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==="image_url")));
      if(protocol==="responses")assert.ok(body.input.some(m=>m.content?.some?.(p=>p.type==="input_image")));
      if(protocol==="anthropic")assert.ok(body.messages.some(m=>m.content?.some?.(p=>p.type==="image"&&p.source.type==="base64")));
      const toolOutputs=protocol==="chat"?body.messages.filter(m=>m.role==="tool"):
        protocol==="responses"?body.input.filter(m=>m.type==="function_call_output"):
          body.messages.flatMap(m=>m.content||[]).filter(p=>p.type==="tool_result");
      assert.ok(!JSON.stringify(toolOutputs).includes(PNG));
    }
    const delta=first?{tool_calls:[{index:0,id:"p1",type:"function",function:{name:"read_source_page",arguments:"{}"}}]}:{content:"The source image was supplied; OCR remains unverified."};
    if(protocol==="chat")return new Response(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: [DONE]\n\n`,{headers:{"content-type":"text/event-stream"}});
    if(protocol==="responses")return new Response(JSON.stringify({output:first?[{type:"function_call",call_id:"p1",name:"read_source_page",arguments:"{}"}]:[{type:"message",role:"assistant",content:[{type:"output_text",text:delta.content}]}]}),{headers:{"content-type":"application/json"}});
    return new Response(JSON.stringify({content:first?[{type:"tool_use",id:"p1",name:"read_source_page",input:{}}]:[{type:"text",text:delta.content}]}),{headers:{"content-type":"application/json"}});
  };
  const client=protocol==="chat"?new OpenAICompatibleClient(modelConfig,fetch):protocol==="responses"?new OpenAIResponsesClient(modelConfig,fetch):new AnthropicMessagesClient(modelConfig,fetch);
  await imageLoop(true,client);
  assert.equal(bodies.length,2);
});
