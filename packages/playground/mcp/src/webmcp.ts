/**
 * WebMCP registration for WordPress Playground.
 *
 * Registers playground tools with `navigator.modelContext` (the
 * Chrome WebMCP API) so that browser-side AI agents can interact
 * with the running Playground site.
 */

import type { PlaygroundClient } from '@wp-playground/remote';
import type { PHPResponseData } from '@php-wasm/universal';
import {
	toolDefinitions,
	siteToolDefinitions,
	presentStorage,
	executeSiteInfo,
} from './tools/tool-definitions';
import type { ToolParam } from './tools/tool-definitions';
import { stringifyError } from './tools/utils';
import type { PlaygroundConfig } from './config';

// -- WebMCP type declarations --

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

export type WebMcpConfig = PlaygroundConfig;

// -- Schema conversion --

function paramsToJsonSchema(params: ToolParam[]): Record<string, unknown> {
	const properties: Record<string, Record<string, unknown>> = {};
	const required: string[] = [];

	for (const param of params) {
		const prop: Record<string, unknown> = {
			type: param.type,
			description: param.description,
		};
		if (param.additionalProperties !== undefined) {
			prop['additionalProperties'] = param.additionalProperties;
		}
		if (param.default !== undefined) {
			prop['default'] = param.default;
		}
		properties[param.name] = prop;
		if (param.required) {
			required.push(param.name);
		}
	}

	const schema: Record<string, unknown> = {
		type: 'object',
		properties,
	};
	if (required.length > 0) {
		schema['required'] = required;
	}
	return schema;
}

// -- Client method mapping --

function decodePHPResponse(response: PHPResponseData) {
	return {
		text: new TextDecoder().decode(response.bytes),
		errors: response.errors,
		exitCode: response.exitCode,
	};
}

function decodeHTTPResponse(response: PHPResponseData) {
	return {
		text: new TextDecoder().decode(response.bytes),
		httpStatusCode: response.httpStatusCode,
		headers: response.headers,
	};
}

const clientMethodMap: Record<
	string,
	(
		client: PlaygroundClient,
		input: Record<string, unknown>
	) => Promise<unknown>
> = {
	playground_execute_php: async (client, input) =>
		decodePHPResponse(await client.run({ code: input['code'] as string })),
	playground_request: async (client, input) => {
		const options: Record<string, unknown> = {
			url: input['url'],
			method: input['method'] ?? 'GET',
		};
		if (input['headers']) {
			options['headers'] = input['headers'];
		}
		if (input['body']) {
			options['body'] = input['body'];
		}
		return decodeHTTPResponse(await client.request(options as any));
	},
	playground_navigate: (client, input) =>
		client.goTo(input['path'] as string),
	playground_get_current_url: (client) => client.getCurrentURL(),
	playground_get_site_info: (client) =>
		executeSiteInfo(
			async (code) => {
				const resp = await client.run({ code });
				return resp.text;
			},
			() => client.getCurrentURL()
		),
	playground_read_file: (client, input) =>
		client.readFileAsText(input['path'] as string),
	playground_write_file: (client, input) =>
		client.writeFile(input['path'] as string, input['contents'] as string),
	playground_list_files: (client, input) =>
		client.listFiles(input['path'] as string),
	playground_mkdir: (client, input) =>
		client.mkdirTree(input['path'] as string),
	playground_delete_file: (client, input) =>
		client.unlink(input['path'] as string),
	playground_delete_directory: (client, input) =>
		client.rmdir(input['path'] as string, {
			recursive: (input['recursive'] as boolean) ?? false,
		}),
	playground_file_exists: (client, input) =>
		client.fileExists(input['path'] as string),
};

// -- Registration --

export function registerWebMCPTools(config: WebMcpConfig): void {
	if (typeof navigator === 'undefined' || !navigator.modelContext) {
		return;
	}

	function getActiveClient(): PlaygroundClient {
		const sites = config.getSites();
		const active = sites.find((s) => s.isActive);
		if (!active) {
			throw new Error('No active Playground site');
		}
		const client = config.getPlaygroundClient(active.slug);
		if (!client) {
			throw new Error(`No client for active site: ${active.slug}`);
		}
		return client;
	}

	// Per-site tools
	const tools: ModelContextTool[] = Object.values(toolDefinitions).map(
		(def) => ({
			name: def.name,
			description: def.description,
			inputSchema: paramsToJsonSchema(def.params),
			annotations: def.annotations,
			execute: async (input) => {
				try {
					const executor = clientMethodMap[def.name];
					if (!executor) {
						return {
							error: `No executor for "${def.name}"`,
						};
					}
					return await executor(getActiveClient(), input);
				} catch (error) {
					return {
						error: `Error in ${def.name}: ${stringifyError(error)}`,
					};
				}
			},
		})
	);

	// Site management tools
	tools.push(...createSiteManagementTools(config));

	navigator.modelContext.provideContext({ tools });
}

function createSiteManagementTools(config: WebMcpConfig): ModelContextTool[] {
	function getActiveSiteSlug(): string {
		const sites = config.getSites();
		const active = sites.find((s) => s.isActive);
		if (!active) {
			throw new Error('No active Playground site');
		}
		return active.slug;
	}

	const listDef = siteToolDefinitions['playground_list_sites'];
	const saveDef = siteToolDefinitions['playground_save_site'];
	const renameDef = siteToolDefinitions['playground_rename_site'];

	const result: ModelContextTool[] = [
		{
			name: listDef.name,
			description: listDef.description,
			annotations: listDef.annotations,
			execute: async () => {
				try {
					return {
						sites: config.getSites().map((s) => ({
							slug: s.slug,
							name: s.name,
							storage: presentStorage(s.storage),
							isActive: s.isActive,
						})),
					};
				} catch (error) {
					return {
						error: `Error listing sites: ${stringifyError(error)}`,
					};
				}
			},
		},
	];

	if (config.saveSite) {
		result.push({
			name: saveDef.name,
			description: saveDef.description,
			annotations: saveDef.annotations,
			execute: async () => {
				try {
					const slug = getActiveSiteSlug();
					const saved = await config.saveSite!(slug);
					return {
						success: true,
						slug: saved.slug,
						storage: presentStorage(saved.storage),
					};
				} catch (error) {
					return {
						error: `Error saving site: ${stringifyError(error)}`,
					};
				}
			},
		});
	}

	if (config.renameSite) {
		result.push({
			name: renameDef.name,
			description: renameDef.description,
			inputSchema: paramsToJsonSchema(renameDef.params),
			annotations: renameDef.annotations,
			execute: async (input) => {
				try {
					const slug = getActiveSiteSlug();
					await config.renameSite!(slug, input['newName'] as string);
					return { success: true };
				} catch (error) {
					return {
						error: `Error renaming site: ${stringifyError(error)}`,
					};
				}
			},
		});
	}

	return result;
}
