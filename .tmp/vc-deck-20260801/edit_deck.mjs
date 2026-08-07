import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, PresentationFile } from "@oai/artifact-tool";

const TMP_DIR = "/Users/rickbarkley/SW_Projects/ai_co/amos-agent/.tmp/vc-deck-20260801";
const SOURCE_PPTX = path.join(TMP_DIR, "template-starter.pptx");
const FINAL_PPTX = "/Users/rickbarkley/SW_Projects/ai_co/amos-labs-investor-deck-vc-meeting-2026-08-01.pptx";
const PREVIEW_DIR = path.join(TMP_DIR, "final-preview");
const LAYOUT_DIR = path.join(TMP_DIR, "final-layout");

async function writeBlob(filePath, blob) {
  await fs.writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
}

function parseInspect(ndjson) {
  return ndjson
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function resolveShapeByText(presentation, slideNumber, exactText) {
  const searchText = exactText.includes("+") ? exactText.split("+")[0].trim() : exactText;
  const snapshot = await presentation.inspect({
    kind: "textbox,shape",
    search: searchText,
    include: "id,slide,name,text,textPreview,bbox",
    maxChars: 10000,
  });
  const record = parseInspect(snapshot.ndjson).find(
    (item) =>
      item.slide === slideNumber &&
      (item.text === exactText || item.textPreview === exactText),
  );
  if (!record) {
    throw new Error(`Unable to resolve slide ${slideNumber} text: ${exactText}`);
  }
  return presentation.resolve(record.id);
}

async function resolveShapeByName(presentation, slideNumber, exactName) {
  const snapshot = await presentation.inspect({
    kind: "textbox,shape",
    search: exactName,
    include: "id,slide,name,text,textPreview,bbox",
    maxChars: 10000,
  });
  const record = parseInspect(snapshot.ndjson).find(
    (item) => item.slide === slideNumber && item.name === exactName,
  );
  if (!record) {
    throw new Error(`Unable to resolve slide ${slideNumber} shape: ${exactName}`);
  }
  return presentation.resolve(record.id);
}

async function main() {
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  await fs.mkdir(LAYOUT_DIR, { recursive: true });

  const presentation = await PresentationFile.importPptx(await FileBlob.load(SOURCE_PPTX));

  const before = await presentation.inspect({
    kind: "slide,textbox,shape,notes,layout",
    search: "AMOS Desktop|ALREADY RUNNING|Sovereign",
    maxChars: 20000,
  });
  await fs.writeFile(path.join(TMP_DIR, "before-edit-inspect.ndjson"), before.ndjson);

  // Slide 5 — make Desktop explicit while keeping Claude, GPT, Codex,
  // open models, and MCP clients visibly first-class.
  const architectureTitle = await resolveShapeByText(
    presentation,
    5,
    "Change the intelligence without reconnecting the company.",
  );
  const interfaceLabel = await resolveShapeByText(presentation, 5, "THE INTELLIGENCE");
  const interfaceList = await resolveShapeByText(
    presentation,
    5,
    "Claude  ·  GPT  ·  Codex  ·  open-weight models  ·  any MCP client",
  );

  architectureTitle.text = "AMOS Desktop is the cockpit. The brain stays portable.";
  interfaceLabel.text = "THE INTERFACES";
  interfaceList.text.set([
    [
      { run: "AMOS Desktop", textStyle: { bold: true, color: "#7A3FF2" } },
      { run: "  ·  Claude  ·  GPT  ·  Codex  ·  open models  ·  any MCP client" },
    ],
  ]);

  const slide5 = presentation.slides.getItem(4);
  slide5.speakerNotes.append(
    "\n[Sources]\n- AMOS product architecture and Desktop positioning; founder-provided, 2026-08-01.\n[/Sources]",
  );

  // Slide 11 — make current revenue, speed, pipeline, and stage explicit.
  const slide11Copy = new Map([
    ["ALREADY RUNNING", "COMMERCIAL TRACTION"],
    ["Live, deployed and being used before broad distribution.", "Revenue is new. The pipeline is already in the millions."],
    ["Public proof today", "Real revenue. Real deals. Active partners."],
    ["SMILEWISE", "REVENUE TODAY"],
    ["Dental SaaS", "$2,200 MRR"],
    ["Treatment-planning software using AMOS as a governed build-and-operations environment.", "All added in the last month across more than eight SMB companies."],
    ["NUVOLA ACADEMY", "ACTIVE DEAL PIPELINE"],
    ["Compliance platform", "$MM+"],
    ["A public-safety training product whose marketing and finance now run through AMOS.", "Includes a large-enterprise pilot; UT and life-sciences conversations remain early-stage."],
    ["PILOT STARTS NEXT WEEK", "PUBLIC-SECTOR WEDGE"],
    ["Network operations", "Nuvola Academy"],
    ["A local franchise pilot with a defined path to wider network rollout if the measured outcome is proven.", "Multiple partners are advancing government contracts focused on law-enforcement training."],
    ["Live playground", "8+ SMBs"],
    ["Real users + signups", "Large-enterprise pilot"],
    ["Paid acquisition live", "UT + life sciences"],
    ["Enterprise pipeline active", "Partners active in every division"],
    ["Source: amoslabs.com; founder-provided launch status", "Source: founder-provided commercial status, August 2026"],
  ]);

  for (const [oldCopy, newCopy] of slide11Copy) {
    const shape = await resolveShapeByText(presentation, 11, oldCopy);
    shape.text = newCopy;
  }

  const slide11 = presentation.slides.getItem(10);
  slide11.speakerNotes.append(
    "\n[Sources]\n- Current MRR, SMB company count, active pipeline scale, large-enterprise pilot, UT and life-sciences stage, Nuvola government-contracting focus, and active partner channels across divisions; founder-provided by Rick Barkley, 2026-08-01.\n[/Sources]",
  );

  // Slide 14 — copy the exact visual treatment of the other AMOS native dots.
  const sovereignDot = await resolveShapeByName(presentation, 14, "Sovereign ●");
  sovereignDot.text = "●";
  sovereignDot.text.style = {
    fontSize: 16,
    typeface: "Arial",
    color: "#26B47E",
    alignment: "center",
    autoFit: "shrinkText",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  const after = await presentation.inspect({
    kind: "slide,textbox,shape,notes,layout",
    search: "AMOS Desktop|COMMERCIAL TRACTION|$2,200|$MM+|PUBLIC-SECTOR WEDGE|Sovereign",
    maxChars: 30000,
  });
  await fs.writeFile(path.join(TMP_DIR, "after-edit-inspect.ndjson"), after.ndjson);

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    await writeBlob(
      path.join(PREVIEW_DIR, `${stem}.png`),
      await presentation.export({ slide, format: "png", scale: 2 }),
    );
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(LAYOUT_DIR, `${stem}.layout.json`), await layout.text());
  }

  await writeBlob(
    path.join(TMP_DIR, "final-montage.webp"),
    await presentation.export({ format: "webp", montage: true, scale: 1 }),
  );

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(FINAL_PPTX);
  console.log(FINAL_PPTX);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
