const SECTION_KEYS = Object.freeze([
  "identity",
  "operator_contract",
  "company_state",
  "company_memory",
  "active_work",
  "authority",
  "recent_history",
  "capabilities",
  "continuation_protocol",
  "grounding"
]);

export function createCompanyCacheTool({ read }) {
  if (typeof read !== "function") {
    throw new Error("Company-cache tool requires a verified cache reader");
  }
  return {
    name: "desktop_read_company_cache",
    source: "desktop",
    description:
      "Read a server-signed, read-only AMOS company briefing while offline. The result is point-in-time context, never live authority. Inspect the returned observed_at and expires_at, and do not claim that cached work is current or executed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        section: {
          type: "string",
          enum: ["summary", "all", ...SECTION_KEYS],
          description:
            "Use summary first, then request only the section needed. Use all only when the complete bounded briefing is necessary."
        }
      }
    },
    handler: async ({ section = "summary" } = {}) => {
      const grant = await read();
      if (!grant?.snapshot) {
        throw new Error("No valid company cache is available. Reconnect to AMOS and refresh it.");
      }
      const snapshot = grant.snapshot;
      const provenance = {
        source: "server_signed_company_cache",
        live: false,
        read_only: true,
        cache_id: grant.claims.cache_id,
        observed_at: snapshot.generated_at || new Date(grant.claims.iat * 1000).toISOString(),
        expires_at: new Date(grant.claims.exp * 1000).toISOString(),
        tenant_slug: grant.claims.tenant_slug,
        role: grant.claims.role,
        scope_fingerprint: grant.claims.scope_fingerprint,
        warning:
          "This is point-in-time context. Reconnect before consequential decisions or claims about current company state."
      };
      if (section === "all") return { provenance, snapshot };
      if (SECTION_KEYS.includes(section)) {
        return {
          provenance,
          section,
          value: snapshot[section] ?? null
        };
      }
      return {
        provenance,
        available_sections: SECTION_KEYS,
        company_state: snapshot.company_state ?? null,
        active_work: snapshot.active_work ?? null,
        recent_history: snapshot.recent_history ?? null,
        next_step:
          "Request a named section when more detail is needed. Reconnect to AMOS before taking company action."
      };
    }
  };
}
