/**
 * 内置技能
 */

export * from './WebResearchSkill'
export * from './CodeGenerationSkill'

import { webResearchSkill } from './WebResearchSkill'
import { codeGenerationSkill } from './CodeGenerationSkill'
import type { AISkill } from '../types'

export const builtinSkills: AISkill[] = [webResearchSkill, codeGenerationSkill]
