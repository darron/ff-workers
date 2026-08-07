import { CANADA_PROVINCE_GEOGRAPHY } from './canada-map-data.js';

const PROVINCES = CANADA_PROVINCE_GEOGRAPHY.map(({ code, name }) => ({
  code: code.toLowerCase(),
  name
}));

const RECORD_TYPES = [
  { code: 'mass', label: 'Mass Killings' },
  { code: 'massother', label: 'Non Firearms Mass Killings' },
  { code: 'massfirearms', label: 'Firearms Mass Killings' },
  { code: 'massfirearmslicensed', label: 'Licensed Firearms Mass Killings' },
  { code: 'oic', label: 'OIC Firearms' },
  { code: 'suicide', label: 'Suicide' }
];

const WEBMCP_SOURCE = String.raw`
(() => {
  const documentModelContext = typeof document !== 'undefined' ? document.modelContext : null;
  const navigatorModelContext = typeof navigator !== 'undefined' ? navigator.modelContext : null;
  const modelContext = [documentModelContext, navigatorModelContext]
    .find((context) => typeof context?.registerTool === 'function');
  if (!modelContext || typeof modelContext.registerTool !== 'function' || typeof AbortController !== 'function') {
    return;
  }

  if (window.__massMurderCanadaWebMcp) {
    return;
  }

  const registrationController = new AbortController();
  const provinces = ${JSON.stringify(PROVINCES)};
  const recordTypes = ${JSON.stringify(RECORD_TYPES)};
  const provinceCodes = new Set(provinces.map(({ code }) => code));
  const recordTypeCodes = new Set(recordTypes.map(({ code }) => code));

  function markdownAlias(path) {
    const match = String(path || '').match(/^([^?#]*)([?#].*)?$/);
    const pathname = match ? match[1] : String(path || '');
    const suffix = match?.[2] || '';

    if (pathname === '/') {
      return '/index.md' + suffix;
    }

    if (
      pathname === '/map/canada' ||
      (pathname.startsWith('/records/') && !pathname.endsWith('.md'))
    ) {
      return pathname + '.md' + suffix;
    }

    return pathname + suffix;
  }

  function rewriteInternalLinks(markdown) {
    return String(markdown || '').replace(/\]\((\/[^)\s]+)\)/g, (_, href) =>
      '](' + markdownAlias(href) + ')'
    );
  }

  async function fetchMarkdown(path) {
    const response = await fetch(path, {
      headers: { Accept: 'text/markdown' },
      signal: registrationController.signal
    });

    if (!response.ok) {
      throw new Error('Markdown request failed with HTTP ' + response.status);
    }

    return rewriteInternalLinks(await response.text());
  }

  const tools = [
    {
      name: 'list_provinces',
      title: 'List Canadian provinces and territories',
      description: 'List the Canadian provinces and territories represented by the public record index, with Markdown links to each filtered page.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      execute: async () => [
        '# Provinces and territories',
        '',
        '- [Canada province map](/map/canada.md)',
        ...provinces.map(({ code, name }) => '- [' + name + '](/records/provinces/' + code + '.md)')
      ].join('\n')
    },
    {
      name: 'list_record_types',
      title: 'List record types',
      description: 'List the public record categories available on Mass Murder Canada, with Markdown links to each filtered page.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      execute: async () => [
        '# Record types',
        '',
        ...recordTypes.map(({ code, label }) => '- [' + label + '](/records/group/' + code + '.md)')
      ].join('\n')
    },
    {
      name: 'list_records',
      title: 'List public records',
      description: 'Return the public record list as Markdown, optionally filtered by one Canadian province or one record type. This tool does not change site data.',
      inputSchema: {
        type: 'object',
        properties: {
          province: {
            type: 'string',
            enum: provinces.map(({ code }) => code),
            description: 'Lowercase Canadian province or territory code, for example ab or on.'
          },
          type: {
            type: 'string',
            enum: recordTypes.map(({ code }) => code),
            description: 'Record category code, for example mass or suicide.'
          }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input = {}) => {
        const province = String(input.province || '').toLowerCase();
        const type = String(input.type || '');

        if (province && !provinceCodes.has(province)) {
          throw new Error('Unknown province code: ' + province);
        }
        if (type && !recordTypeCodes.has(type)) {
          throw new Error('Unknown record type: ' + type);
        }
        if (province && type) {
          throw new Error('Provide either province or type, not both.');
        }

        const path = province
            ? '/records/provinces/' + encodeURIComponent(province) + '.md'
            : type
            ? '/records/group/' + encodeURIComponent(type) + '.md'
            : '/index.md';
        return fetchMarkdown(path);
      }
    },
    {
      name: 'get_record',
      title: 'Get one public record',
      description: 'Return one public Mass Murder Canada record as Markdown by its record ID. This tool is read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]+$',
            description: 'The public record ID from a record link.'
          }
        },
        required: ['id'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input = {}) => {
        const id = String(input.id || '');
        if (!/^[A-Za-z0-9_-]+$/.test(id)) {
          throw new Error('Record ID must contain only letters, numbers, hyphens, and underscores.');
        }
        return fetchMarkdown('/records/' + encodeURIComponent(id) + '.md');
      }
    }
  ];

  window.__massMurderCanadaWebMcp = { registrationController, tools };
  Promise.all(
    tools.map((tool) => modelContext.registerTool(tool, {
      signal: registrationController.signal
    }))
  ).catch((error) => {
    registrationController.abort(error);
    delete window.__massMurderCanadaWebMcp;
    console.warn('Mass Murder Canada WebMCP registration failed', error);
  });
})();
`;

export function renderWebMcpScript() {
  return `<script>\n${WEBMCP_SOURCE}\n</script>`;
}
