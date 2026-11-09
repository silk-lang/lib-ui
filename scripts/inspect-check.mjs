import { createInterface } from 'node:readline';
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from './internal.mjs';
import { withDisplay, start, stop } from './native-run.mjs';
import { program, inspectorCLI, expect, json, picture, png, work } from './inspector.mjs';

export async function inspect() {
  const binary = build('ui/tree/demo');
  const cli = inspectorCLI();
  await withDisplay('x11', async env => {
    const app = await program('inbox', binary, [], env, cli);
    try {
      const command = app.command;
      const before = command('snapshot');
      expect(before.status === 0 && before.stdout.includes('role=button label="New"'), 'snapshot lists New button');
      expect(!before.stdout.includes('A new message'), 'no new row before click');
      expect(json(command('click', '--role', 'button', '--name', 'New')).node === 10, 'click New by role and name');
      expect(command('wait', '--text', 'A new message', '--timeout', '10000').status === 0, 'click creates row');
      expect(command('snapshot').stdout.includes('"A new message"'), 'snapshot contains row');
      expect(JSON.stringify(json(command('highlight', '--role', 'button', '--name', 'Archive')).nodes) === '[20]', 'highlight Archive');
      const view = command('inspect', '--role', 'button', '--name', 'Archive');
      expect(view.status === 0 && view.stdout.startsWith('box #20'), 'inspect Archive');
      const shot = resolve(work, 'inspect.png');
      rmSync(shot, { force: true });
      expect(command('screenshot', shot).status === 0, 'capture inspector screenshot');
      picture(shot);
      expect(command('stats').stdout.includes('"nodes":'), 'stats');
      const missing = command('click', '--name', 'no such button');
      expect(missing.status === 1 && missing.stderr.includes('no node matches'), 'missing node is an error');
    } finally { await app.close(); }
  });
}

class McpClient {
  constructor(binary, env) {
    this.child = start(binary, [], env, ['pipe', 'pipe', 'inherit']);
    this.id = 0;
    this.pending = new Map();
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let reply;
      try { reply = JSON.parse(line); } catch (error) { this.fail(error); return; }
      const request = this.pending.get(reply.id);
      if (!request) { this.fail(new Error(`Unexpected MCP response id ${reply.id}`)); return; }
      clearTimeout(request.timer);
      this.pending.delete(reply.id);
      request.resolve(reply);
    });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`MCP server exited ${code}`)));
  }
  fail(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  notify(method, params) { this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  call(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async tool(name, arguments_ = {}) {
    const reply = await this.call('tools/call', { name, arguments: arguments_ });
    expect(!reply.error, `MCP ${name} reply`);
    return reply.result;
  }
  async close() {
    if (this.child.exitCode !== null) return this.child.exitCode;
    const result = new Promise((resolve, reject) => {
      this.child.once('exit', resolve);
      this.child.once('error', reject);
    });
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 10000);
    this.child.stdin.end();
    try { return await result; } finally { clearTimeout(timer); this.lines.close(); }
  }
}

export async function mcp() {
  const binary = build('ui/tree/demo');
  const cli = inspectorCLI();
  const server = build('ui/inspect/mcp');
  await withDisplay('x11', async env => {
    const app = await program('mcp-inbox', binary, [], env, cli);
    const client = new McpClient(server, { ...env, SILK_UI_INSPECT: app.socket });
    try {
      const init = (await client.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lib-ui-check', version: '1' } })).result;
      expect(init.protocolVersion === '2025-06-18' && 'tools' in init.capabilities, 'MCP initialize');
      client.notify('notifications/initialized');
      const tools = (await client.call('tools/list')).result.tools.map(tool => tool.name);
      expect(['ui_snapshot', 'ui_click', 'ui_wait', 'ui_screenshot'].every(tool => tools.includes(tool)), 'MCP tools/list');
      const snap = await client.tool('ui_snapshot');
      const text = snap.content[0].text;
      expect(text.split('\n').some(line => line.includes('label="New"') && line.includes('role=button')), 'MCP snapshot discovers New button');
      expect(!text.includes('A new message'), 'MCP no row before click');
      const click = await client.tool('ui_click', { label: 'New', exact: true });
      expect(!click.isError && JSON.parse(click.content[0].text).node === 10, 'MCP clicks by label');
      expect(!(await client.tool('ui_wait', { text: 'A new message', timeout: 10000 })).isError, 'MCP waits for new row');
      expect((await client.tool('ui_snapshot')).content[0].text.includes('"A new message"'), 'MCP snapshot shows new row');
      const view = await client.tool('ui_inspect', { role: 'button', name: 'Archive' });
      expect(!view.isError && view.content[0].text.startsWith('box #20'), 'MCP inspect');
      expect(!(await client.tool('ui_highlight', { role: 'button', name: 'Archive' })).isError, 'MCP highlight');
      const image = (await client.tool('ui_screenshot')).content[0];
      const bytes = Buffer.from(image.data, 'base64');
      expect(image.type === 'image' && image.mimeType === 'image/png' && bytes.subarray(0, 8).equals(png), 'MCP screenshot returns PNG image');
      writeFileSync(resolve(work, 'mcp.png'), bytes);
      const missing = await client.tool('ui_click', { name: 'no such button' });
      expect(missing.isError && missing.content[0].text === 'no node matches', 'MCP missing node is tool error');
    } finally {
      try { expect(await client.close() === 0, 'MCP exits when stdin closes'); }
      finally { await stop(client.child); await app.close(); }
    }
  });
}
