import { describe, it, expect } from 'vitest';
import { formatSkills, buildInstructions } from '../types';
import type { SkillDefinition } from '../types';

describe('formatSkills', () => {
  const mockSkills: SkillDefinition[] = [
    {
      name: 'brain',
      description: 'Knowledge base management',
      content: 'Full brain skill content here...',
      filePath: '/skills/brain/SKILL.md'
    },
    {
      name: 'eval-refine-loop',
      description: 'Quality evaluation loop',
      content: 'Full eval content...',
      filePath: '/skills/eval-refine-loop/SKILL.md'
    }
  ];

  it('should return empty string for empty skills', () => {
    expect(formatSkills([])).toBe('');
  });

  it('should use summary mode by default (no content injected)', () => {
    const result = formatSkills(mockSkills);
    expect(result).toContain('<skills>');
    expect(result).toContain('</skills>');
    expect(result).toContain('<skill name="brain" path="/skills/brain/SKILL.md">');
    expect(result).toContain('Knowledge base management');
    expect(result).not.toContain('Full brain skill content here');
    expect(result).toContain('read tool for full instructions');
  });

  it('should include filePath attribute in summary mode', () => {
    const result = formatSkills(mockSkills);
    expect(result).toContain('path="/skills/brain/SKILL.md"');
    expect(result).toContain('path="/skills/eval-refine-loop/SKILL.md"');
  });

  it('should handle skills without filePath in summary mode', () => {
    const noPathSkill: SkillDefinition[] = [{ name: 'test', description: 'Test skill', content: 'content' }];
    const result = formatSkills(noPathSkill);
    expect(result).toContain('<skill name="test">');
    expect(result).not.toContain('path=');
  });

  it('should inject full content in full mode', () => {
    const result = formatSkills(mockSkills, 'full');
    expect(result).toContain('<content>');
    expect(result).toContain('Full brain skill content here...');
    expect(result).toContain('Full eval content...');
    expect(result).not.toContain('read tool for full instructions');
  });

  it('summary mode should be significantly smaller than full mode', () => {
    const longSkills: SkillDefinition[] = [
      {
        name: 'long-skill',
        description: 'Short desc',
        content: 'x'.repeat(5000),
        filePath: '/skills/long/SKILL.md'
      }
    ];
    const summary = formatSkills(longSkills, 'summary');
    const full = formatSkills(longSkills, 'full');
    expect(summary.length).toBeLessThan(full.length / 5);
  });
});

describe('buildInstructions', () => {
  it('should build with instructions only', () => {
    const result = buildInstructions('You are a helpful assistant.');
    expect(result).toBe('You are a helpful assistant.');
  });

  it('should append skills in summary mode', () => {
    const skills: SkillDefinition[] = [
      { name: 'test', description: 'Test', content: 'Full content', filePath: '/test/SKILL.md' }
    ];
    const result = buildInstructions('Base instructions', skills);
    expect(result).toContain('Base instructions');
    expect(result).toContain('<skills>');
    expect(result).not.toContain('Full content');
  });

  it('should append additional instructions', () => {
    const result = buildInstructions('Base', undefined, ['<extra>Extra info</extra>']);
    expect(result).toContain('Base');
    expect(result).toContain('<extra>Extra info</extra>');
  });

  it('should combine all parts', () => {
    const skills: SkillDefinition[] = [
      { name: 'test', description: 'Test', content: 'content', filePath: '/test/SKILL.md' }
    ];
    const result = buildInstructions('Base', skills, ['<extra>Extra</extra>']);
    expect(result).toContain('Base');
    expect(result).toContain('<skills>');
    expect(result).toContain('<extra>Extra</extra>');
  });
});
