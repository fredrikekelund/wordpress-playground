import type { PlaygroundClient } from '@wp-playground/remote';

// -- WebMCP type declarations (no published @types yet) --

interface ModelContextTool {
	name: string;
	description: string;
	inputSchema?: Record<string, unknown>;
	execute: (
		input: Record<string, unknown>,
		client: ModelContextClient
	) => Promise<unknown>;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

interface ModelContextClient {
	requestUserInteraction(callback: () => Promise<unknown>): Promise<unknown>;
}

interface ModelContext {
	provideContext(options: { tools: ModelContextTool[] }): void;
	clearContext(): void;
	registerTool(tool: ModelContextTool): void;
	unregisterTool(name: string): void;
}

declare global {
	interface Navigator {
		modelContext?: ModelContext;
	}
}

// -- Tool registry --

interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	clientMethod: keyof PlaygroundClient;
	mapArgs?: (input: Record<string, unknown>) => unknown[];
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

const toolRegistry: ToolDefinition[] = [
	// -- PHP Execution --
	{
		name: 'run-php',
		description:
			'Execute PHP code in the WordPress Playground and return ' +
			'the response. Provide a `code` string with PHP code ' +
			'(without <?php tag) to evaluate.',
		inputSchema: {
			type: 'object',
			properties: {
				code: {
					type: 'string',
					description: 'PHP code to execute (without <?php tag)',
				},
			},
			required: ['code'],
		},
		clientMethod: 'run',
		mapArgs: (input) => [{ code: input.code as string }],
	},
	{
		name: 'request',
		description:
			'Send an HTTP request to the WordPress site running in ' +
			'Playground. Returns the HTTP response with status, ' +
			'headers, and body text.',
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description:
						'Request path (e.g. "/wp-admin/") or ' + 'absolute URL',
				},
				method: {
					type: 'string',
					description: 'HTTP method (GET, POST, etc). Default: GET',
				},
				headers: {
					type: 'object',
					description: 'Request headers as key-value pairs',
				},
				body: {
					type: 'string',
					description: 'Request body string',
				},
			},
			required: ['url'],
		},
		clientMethod: 'request',
		mapArgs: (input) => [
			{
				url: input.url as string,
				method: input.method as string | undefined,
				headers: input.headers as Record<string, string> | undefined,
				body: input.body as string | undefined,
			},
		],
	},

	// -- Navigation --
	{
		name: 'go-to',
		description:
			'Navigate the WordPress site to the given path. ' +
			'For example, "/wp-admin/" or "/sample-page/".',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description:
						'The path to navigate to ' + '(e.g. "/wp-admin/")',
				},
			},
			required: ['path'],
		},
		clientMethod: 'goTo',
		mapArgs: (input) => [input.path as string],
	},
	{
		name: 'get-current-url',
		description:
			'Get the current URL path of the WordPress site ' +
			'displayed in Playground.',
		inputSchema: { type: 'object', properties: {} },
		clientMethod: 'getCurrentURL',
		mapArgs: () => [],
		annotations: { readOnlyHint: true },
	},

	// -- Filesystem --
	{
		name: 'read-file',
		description:
			'Read the text contents of a file in the WordPress ' +
			'filesystem. Paths are absolute, e.g. ' +
			'"/wordpress/wp-config.php".',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description:
						'Absolute filesystem path ' +
						'(e.g. "/wordpress/wp-config.php")',
				},
			},
			required: ['path'],
		},
		clientMethod: 'readFileAsText',
		mapArgs: (input) => [input.path as string],
		annotations: { readOnlyHint: true },
	},
	{
		name: 'write-file',
		description:
			'Write text content to a file in the WordPress ' +
			'filesystem. Creates the file if it does not exist, ' +
			'overwrites if it does.',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Absolute filesystem path',
				},
				data: {
					type: 'string',
					description: 'Text content to write',
				},
			},
			required: ['path', 'data'],
		},
		clientMethod: 'writeFile',
		mapArgs: (input) => [input.path as string, input.data as string],
		annotations: { destructiveHint: true },
	},
	{
		name: 'list-files',
		description:
			'List files and directories in a directory in the ' +
			'WordPress filesystem. Returns an array of names.',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description:
						'Absolute directory path ' +
						'(e.g. "/wordpress/wp-content/plugins")',
				},
			},
			required: ['path'],
		},
		clientMethod: 'listFiles',
		mapArgs: (input) => [input.path as string],
		annotations: { readOnlyHint: true },
	},
	{
		name: 'mkdir',
		description:
			'Create a directory (and any missing parent ' +
			'directories) in the WordPress filesystem.',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Absolute directory path to create',
				},
			},
			required: ['path'],
		},
		clientMethod: 'mkdirTree',
		mapArgs: (input) => [input.path as string],
	},
	{
		name: 'unlink',
		description: 'Delete a file from the WordPress filesystem.',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Absolute path of the file to delete',
				},
			},
			required: ['path'],
		},
		clientMethod: 'unlink',
		mapArgs: (input) => [input.path as string],
		annotations: { destructiveHint: true },
	},
	{
		name: 'file-exists',
		description:
			'Check whether a file or directory exists in the ' +
			'WordPress filesystem.',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Absolute path to check',
				},
			},
			required: ['path'],
		},
		clientMethod: 'fileExists',
		mapArgs: (input) => [input.path as string],
		annotations: { readOnlyHint: true },
	},
];

// -- Registration --

export function registerWebMCPTools(client: PlaygroundClient): void {
	if (!navigator.modelContext) {
		return;
	}

	const tools: ModelContextTool[] = toolRegistry.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
		annotations: tool.annotations,
		execute: async (input) => {
			const args = tool.mapArgs ? tool.mapArgs(input) : [input];
			return await (client as any)[tool.clientMethod](...args);
		},
	}));

	navigator.modelContext.provideContext({ tools });
	console.log(`WebMCP: registered ${tools.length} tools`); // remove before committing
}
