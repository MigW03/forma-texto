import { getGuideline, type Guideline } from './guidelines'
import { rewriteStyles } from './rewriteStyles'
import { stripDirectOverrides } from './stripOverrides'
import { rewriteMargins } from './rewriteMargins'
import { resolveDocumentFont } from './fontPolicy'

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
 *   1. resolve the one font family for the whole doc (keep the source's accepted
 *      family, else the guideline default) so body and headings always match
 *   2. styles.xml   → guideline-correct Normal + Heading1-3 in that family
 *   3. document.xml → strip direct layout overrides (so styles cascade)
 *   4. document.xml → guideline page margins
 */
export function applyStepA({ documentXml, stylesXml, guideline }: StepAInput): StepAOutput {
  const g = getGuideline(guideline)
  const font = resolveDocumentFont(documentXml, stylesXml, g.accepted, g.body.font)
  const newStyles = rewriteStyles(stylesXml, guideline, font)
  let doc = stripDirectOverrides(documentXml)
  doc = rewriteMargins(doc, guideline)
  return { documentXml: doc, stylesXml: newStyles }
}
