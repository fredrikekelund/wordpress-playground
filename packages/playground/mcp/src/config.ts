import type { PlaygroundClient } from '@wp-playground/remote';

/**
 * Shared configuration for the MCP bridge client and WebMCP.
 *
 * Both transports need the same callbacks to interact with
 * the Playground site list and active client.
 */
export interface PlaygroundConfig {
	getSites: () => Array<{
		slug: string;
		name: string;
		storage: string;
		isActive: boolean;
	}>;
	getPlaygroundClient: (siteSlug: string) => PlaygroundClient | undefined;
	renameSite?: (siteSlug: string, newName: string) => Promise<void>;
	saveSite?: (siteSlug: string) => Promise<{ slug: string; storage: string }>;
}
