import { describe, expect, it } from 'vitest';
import { executeTool, registerTool, setToolGuard, setToolLogger } from './webmcp';

describe('WebMCP denied-action logging', () => {
  it('logs unknown tool denial without executing anything', async () => {
    const denied: string[] = [];
    setToolLogger((name, allowed, detail) => {
      if (!allowed) denied.push(`${name}:${detail}`);
    });

    const result = await executeTool('shell.exec', {});

    expect(result.content[0].text).toMatch(/unknown WebMCP tool/);
    expect(denied).toEqual(['shell.exec:unknown WebMCP tool']);
  });

  it('logs non-object arg denial before tool execution', async () => {
    const denied: string[] = [];
    let executed = false;
    setToolGuard(() => ({ allowed: true }));
    setToolLogger((name, allowed, detail) => {
      if (!allowed) denied.push(`${name}:${detail}`);
    });
    registerTool({
      name: 'graph.search',
      description: 'test search',
      execute: () => {
        executed = true;
        return { content: [{ type: 'text', text: 'ran' }] };
      },
    });

    const result = await executeTool('graph.search', 'not object');

    expect(result.content[0].text).toMatch(/args must be an object/);
    expect(executed).toBe(false);
    expect(denied).toEqual(['graph.search:WebMCP args must be an object']);
  });
});
