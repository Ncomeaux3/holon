import { loadSkillTree } from '../data'
import { SkillTree } from './SkillTree'

export default async function SkillTreePage() {
  const data = await loadSkillTree()

  // The band, the panes and the heading all live in the client component: the
  // band's Reset view has to reach the canvas, and the artboard's page is the
  // constellation with no title block above it.
  return <SkillTree data={data} now={data.now} />
}
