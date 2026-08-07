export const AGENT_SKILLS_INDEX_PATH = '/.well-known/agent-skills/index.json';
export const MASS_MURDER_CANADA_RESEARCH_SKILL_PATH = '/.well-known/agent-skills/mass-murder-canada-research/SKILL.md';
export const AGENT_SKILLS_INDEX_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
export const MASS_MURDER_CANADA_RESEARCH_SKILL_DIGEST = 'sha256:156897e4180a05f5badb994d5f1e6f25880d9df1573bfea58cc469cfa5551a2b';

export const MASS_MURDER_CANADA_RESEARCH_SKILL = String.raw`---
name: mass-murder-canada-research
description: Research Mass Murder Canada public records with read-only WebMCP tools and Markdown pages.
---

# Mass Murder Canada research

Use this skill when researching the public record index at massmurdercanada.org. The site is a collected research index that points to other resources; use the linked source stories when a claim needs verification.

## Scope

This workflow is read-only. Do not use admin, ingest, authentication, or mutation paths.

## Preferred browser workflow

On a page in a WebMCP-capable browser, use these read-only tools:

- list_provinces: return Canadian province and territory pages.
- list_record_types: return the available record-category pages.
- list_records: return the public record list. Pass at most one filter: province with a lowercase code such as ab or on, or type with a category code such as mass or suicide.
- get_record: return one public record by its record ID.

Tool results are Markdown. Follow internal links ending in .md when you want a directly addressable Markdown response.

## Markdown fallback

When WebMCP is unavailable, request the public page with an Accept header of text/markdown. The same representation is available through these explicit paths:

- /index.md for the complete public record list
- /map/canada.md for the province map summary
- /records/provinces/{code}.md for one province or territory
- /records/group/{type}.md for one record category
- /records/{id}.md for one record

The ordinary URLs remain the canonical browser links and return HTML by default.

## Research workflow

1. Use list_provinces or list_record_types to identify the relevant index.
2. Use list_records with one filter to narrow the public records.
3. Use get_record, or follow the record Markdown link, for the detailed record.
4. Read the linked news and official source URLs when checking important facts.
5. Cite the public record URL and the relevant source URLs in the answer.

## Interpretation

Treat record fields as the site's collected data, not as proof that the index is complete. Treat AI Synthesis as a summary; check the linked source stories for material claims. Keep the record's incident data separate from later reporting, commentary, or unrelated facts in a source.
`;

export function renderAgentSkillsIndex() {
  return `${JSON.stringify({
    $schema: AGENT_SKILLS_INDEX_SCHEMA,
    skills: [{
      name: 'mass-murder-canada-research',
      type: 'skill-md',
      description: 'Research Mass Murder Canada public records with read-only WebMCP tools and Markdown pages.',
      url: MASS_MURDER_CANADA_RESEARCH_SKILL_PATH,
      digest: MASS_MURDER_CANADA_RESEARCH_SKILL_DIGEST
    }]
  }, null, 2)}\n`;
}
