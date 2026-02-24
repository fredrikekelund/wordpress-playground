import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const test = base.extend<{ webmcpPage: Page }>({
	webmcpPage: async ({ page }, use) => {
		// Inject mock navigator.modelContext BEFORE page loads.
		// The mock captures provideContext calls so we can
		// inspect and invoke the registered tools.
		await page.addInitScript(() => {
			const registeredTools: Array<{
				name: string;
				description: string;
				inputSchema?: Record<string, unknown>;
				annotations?: Record<string, unknown>;
				execute: (input: Record<string, unknown>) => Promise<unknown>;
			}> = [];

			(navigator as any).modelContext = {
				provideContext({ tools }: { tools: typeof registeredTools }) {
					registeredTools.length = 0;
					registeredTools.push(...tools);
					(window as any).__webmcpTools = tools.map((t) => ({
						name: t.name,
						description: t.description,
						inputSchema: t.inputSchema,
						annotations: t.annotations,
					}));
					(window as any).__webmcpExecutors = Object.fromEntries(
						tools.map((t) => [t.name, t.execute])
					);
				},
				clearContext() {
					registeredTools.length = 0;
				},
				registerTool(tool: (typeof registeredTools)[0]) {
					registeredTools.push(tool);
				},
				unregisterTool(name: string) {
					const idx = registeredTools.findIndex(
						(t) => t.name === name
					);
					if (idx !== -1) registeredTools.splice(idx, 1);
				},
			};
		});

		await page.goto('/');
		// Wait for WordPress to load inside nested iframes
		await expect(
			page
				.frameLocator(
					'#playground-viewport:visible,' +
						'.playground-viewport:visible'
				)
				.frameLocator('#wp')
				.locator('body')
		).not.toBeEmpty();

		// Wait for WebMCP tools to be registered
		await expect
			.poll(() => page.evaluate(() => (window as any).__webmcpTools), {
				timeout: 30_000,
				intervals: [1_000],
			})
			.toBeTruthy();

		// Wait for the PlaygroundClient to be available via
		// WebMCP tools. The client is added to the Redux store
		// after startPlaygroundWeb resolves, which may happen
		// after the iframe content is visible and tools are
		// registered.
		await expect
			.poll(
				() =>
					page.evaluate(async () => {
						try {
							const executors = (window as any).__webmcpExecutors;
							if (!executors?.playground_get_current_url)
								return false;
							await executors.playground_get_current_url({});
							return true;
						} catch {
							return false;
						}
					}),
				{ timeout: 60_000, intervals: [1_000] }
			)
			.toBe(true);

		await use(page);
	},
});

test('WebMCP registers all 15 tools (12 playground + 3 site management)', async ({
	webmcpPage,
}) => {
	const tools = await webmcpPage.evaluate(
		() => (window as any).__webmcpTools
	);
	expect(tools).toHaveLength(15);
	const names = tools.map((t: { name: string }) => t.name).sort();
	expect(names).toEqual([
		'playground_delete_directory',
		'playground_delete_file',
		'playground_execute_php',
		'playground_file_exists',
		'playground_get_current_url',
		'playground_get_site_info',
		'playground_list_files',
		'playground_list_sites',
		'playground_mkdir',
		'playground_navigate',
		'playground_read_file',
		'playground_rename_site',
		'playground_request',
		'playground_save_site',
		'playground_write_file',
	]);
});

test('WebMCP playground_execute_php runs PHP code', async ({ webmcpPage }) => {
	const result = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_execute_php']({
			code: '<?php echo "Hello WebMCP";',
		});
	});
	expect(result.text).toContain('Hello WebMCP');
	expect(result.exitCode).toBe(0);
});

test('WebMCP playground_read_file reads wp-config.php', async ({
	webmcpPage,
}) => {
	const result = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_read_file']({
			path: '/wordpress/wp-config.php',
		});
	});
	expect(result).toContain('DB_NAME');
});

test('WebMCP playground_file_exists checks existence', async ({
	webmcpPage,
}) => {
	const exists = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_file_exists']({
			path: '/wordpress/wp-config.php',
		});
	});
	expect(exists).toBe(true);

	const missing = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_file_exists']({
			path: '/wordpress/nope.txt',
		});
	});
	expect(missing).toBe(false);
});

test('WebMCP playground_get_current_url returns URL', async ({
	webmcpPage,
}) => {
	const url = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_get_current_url']({});
	});
	expect(url).toBeTruthy();
	expect(typeof url).toBe('string');
});

test('WebMCP playground_get_site_info returns WP info', async ({
	webmcpPage,
}) => {
	const info = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_get_site_info']({});
	});
	expect(info.wpVersion).toBeTruthy();
	expect(info.phpVersion).toBeTruthy();
	expect(info.documentRoot).toContain('/wordpress');
});

test('WebMCP playground_list_sites returns sites', async ({ webmcpPage }) => {
	const result = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_list_sites']({});
	});
	expect(result.sites).toBeInstanceOf(Array);
	expect(result.sites.length).toBeGreaterThan(0);
	const site = result.sites[0];
	expect(site.slug).toBeTruthy();
	expect(site.name).toBeTruthy();
	expect(site.isActive).toBe(true);
});

test('WebMCP playground_save_site saves a site', async ({ webmcpPage }) => {
	const result = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_save_site']({});
	});
	expect(result.success).toBe(true);
	expect(result.slug).toBeTruthy();
});

test('WebMCP playground_rename_site renames a site', async ({ webmcpPage }) => {
	const result = await webmcpPage.evaluate(async () => {
		const executors = (window as any).__webmcpExecutors;
		return await executors['playground_rename_site']({
			newName: 'WebMCP Test Site',
		});
	});
	expect(result.success).toBe(true);
});
