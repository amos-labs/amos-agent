export function createAttachmentTools({ read }) {
  return [{
    name: "desktop_read_attachment",
    source: "desktop",
    toolkit: "documents",
    description: "Read another bounded section of a task attachment by its attachment ID when the initial excerpt was truncated.",
    parameters: {
      type: "object",
      properties: {
        attachment_id: { type: "string", description: "Attachment ID from the task reference manifest." },
        offset: { type: "integer", minimum: 0, description: "Character offset to begin reading from." },
        max_chars: { type: "integer", minimum: 1_000, maximum: 20_000, description: "Maximum characters to return." },
        query: { type: "string", description: "Optional exact text to locate before reading a surrounding section." }
      },
      required: ["attachment_id"],
      additionalProperties: false
    },
    handler(args) {
      return read({
        id: args.attachment_id,
        offset: args.offset,
        maxChars: args.max_chars,
        query: args.query
      });
    }
  }];
}
