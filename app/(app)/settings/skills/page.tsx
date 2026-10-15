import { EmptyState } from '@/components/pos'
import { getModule } from '@/core/modules'
import { loadMergedTree, loadOverrides } from '@/modules/skills/tree'
import { SettingsHeader } from '../tabs'
import { SkillsEditor } from './SkillsEditor'

export default async function SkillsSettingsPage() {
  // The tab is only reachable while the module that owns the tree is installed.
  if (!getModule('skills')) {
    return (
      <div className="space-y-[18px]">
        <SettingsHeader current="/settings/skills" />
        <EmptyState headline="Skill Tree is not installed">
          The tree, its keywords and its XP weights live in modules/skills. Without that folder
          nothing classifies, and there is nothing here to edit.
        </EmptyState>
      </div>
    )
  }

  const [tree, overrides] = await Promise.all([loadMergedTree(), loadOverrides()])
  const live = tree.filter((s) => !s.deleted)

  // One card per branch, as the artboard groups them: a branch is any node
  // with leaves under it, labelled by its path ("Engineering · Coding").
  const byId = new Map(tree.map((n) => [n.id, n]))
  const hasChildren = (id: string) => tree.some((n) => n.parent === id)
  const pathOf = (id: string): string => {
    const node = byId.get(id)
    if (!node) return id
    return node.parent ? `${pathOf(node.parent)} · ${node.name}` : node.name
  }
  const groups = tree
    .filter((n) => hasChildren(n.id) && tree.some((c) => c.parent === n.id && !hasChildren(c.id)))
    .map((branch) => ({
      attribute: { ...branch, name: pathOf(branch.id) },
      skills: tree.filter((c) => c.parent === branch.id && !hasChildren(c.id)),
    }))

  return (
    <div className="space-y-[18px]">
      <SettingsHeader current="/settings/skills" skillCount={live.length} />

      <SkillsEditor groups={groups} overrideCount={overrides.length} />

      <p className="max-w-[860px] text-footnote text-secondary-label">
        modules/skills/skills.yaml is the committed default and stays generic, so a fork gets a
        usable tree and none of yours. Everything you change here is a row in skills.override, which
        is also why the tree is editable in production: the filesystem there is read only.
      </p>
    </div>
  )
}
