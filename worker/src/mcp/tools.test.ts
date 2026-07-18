import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from './tools';

describe('MCP tool registry', () => {
  it('exposes exactly the 10 spec tools, no cancellation tools', () => {
    const names = ALL_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_community_links',
      'get_event',
      'get_guild_info',
      'get_photos',
      'join_guild_path',
      'join_waitlist',
      'list_events',
      'my_status',
      'register_for_event',
      'search_library',
    ]);
    expect(names.some((n) => /cancel/.test(n))).toBe(false);
  });

  it('every tool has a description and an object inputSchema', () => {
    for (const t of ALL_TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect((t.inputSchema as any).type).toBe('object');
    }
  });
});
