import type { Guideline } from './guidelines'
import { rewriteStyles } from './rewriteStyles'
import { stripDirectOverrides } from './stripOverrides'
import { rewriteMargins } from './rewriteMargins'

export interface StepAInput {
  documentXml: string
  stylesXml: string | null
  guideline: Guideline
}

export interface StepAOutput {
  documentXml: string
  stylesXml: string
}

/**
 * Step A — the full deterministic (no-AI) formatting pass.
 *   1. styles.xml   → guideline-correct Normal + Heading1-3
 *   2. document.xml → strip direct layout overrides (so styles cascade)
 *   3. document.xml → guideline page margins
 */
export function applyStepA({ documentXml, stylesXml, guideline }: StepAInput): StepAOutput {
  const newStyles = rewriteStyles(stylesXml, guideline)
  let doc = stripDirectOverrides(documentXml)
  doc = rewriteMargins(doc, guideline)
  return { documentXml: doc, stylesXml: newStyles }
}
