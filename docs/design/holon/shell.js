// Mockup shell: the rail, the phone tab bar, the theme control and the page
// switcher. Static HTML has no includes, so the four pages share this instead
// of four copies of the rail. Nothing here is app code.
(function () {
  const I = {
    today: '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
    tasks: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    skills: '<path d="M12 3v18M5 8l7 4 7-4M5 16l7-4 7 4"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 2 3v1a3 3 0 0 0 3 3h1V4H9zM15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-2 3v1a3 3 0 0 1-3 3h-1V4h1z"/>',
    ideas: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1.9 1.8V16h5.2v-.3c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3z"/>',
    finance: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h3"/>',
    health: '<path d="M20 12h-3l-2 5-4-10-2 5H4"/>',
    fitness: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
    meals: '<path d="M6 3v8a2 2 0 0 0 2 2h0V3M10 3v10M8 13v8M17 3c-2 0-3 2-3 5v3h3v10"/>',
    travel: '<path d="M3 13l8-1 3-8 2 1-1 7 6 3-1 2-6-1-3 5-2-1 1-5-6-1z"/>',
    home: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
    insurance: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    review: '<path d="M4 6h16v10H8l-4 4z"/>',
    weekly: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>',
    notifications: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    log: '<path d="M4 6h16M4 12h10M4 18h7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h5l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z"/>',
    browse: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  }
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`
  const wordmark =
    '<svg viewBox="18 28 368 114" role="img" aria-label="Holon"><g transform="translate(18 142) scale(0.15)" fill="currentColor" fill-rule="evenodd">' +
    '<path d="M0 0H104V-302H482V0H586V-720H482V-401H104V-720H0Z"/>' +
    '<path transform="translate(646 0)" d="M270 -550A275 275 0 1 1 269.99 -550Z M270 -453A178 178 0 1 0 270.01 -453Z"/>' +
    '<path transform="translate(1226 0)" d="M0 0H98V-756H0Z"/>' +
    '<path transform="translate(1382 0)" d="M270 -550A275 275 0 1 1 269.99 -550Z M270 -453A178 178 0 1 0 270.01 -453Z"/>' +
    '<path transform="translate(1962 0)" d="M0 0V-302C0 -466 96 -550 247 -550C398 -550 494 -466 494 -302V0H396V-299C396 -402 343 -453 247 -453C151 -453 98 -402 98 -299V0Z"/></g></svg>'
  const mark = '../../../holon-cobalt-sand/exports/holon-optical-64.png'

  const groups = [
    { label: null, items: [['today', 'Today', 'today.html']] },
    { label: 'Plan', items: [['tasks', 'Tasks', 'tasks.html'], ['goals', 'Goals'], ['skills', 'Skills']] },
    { label: 'Knowledge', items: [['brain', 'Second Brain'], ['ideas', 'Ideas']] },
    { label: 'Life', items: [['finance', 'Finance', 'finance.html'], ['health', 'Health'], ['fitness', 'Fitness'], ['meals', 'Meals'], ['travel', 'Travel'], ['home', 'Home & Property'], ['insurance', 'Insurance']] },
    { label: null, items: [['review', 'Review', null, 2], ['weekly', 'Weekly review']] },
  ]
  const foot = [['search', 'Search'], ['notifications', 'Notifications'], ['log', 'Agent log'], ['settings', 'Settings']]

  const page = document.body.dataset.page
  const link = ([id, label, href, badge]) =>
    `<a href="${href || '#'}" ${id === page ? 'aria-current="page"' : ''}>${svg(id)}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`

  const rail = document.createElement('nav')
  rail.className = 'rail'
  rail.setAttribute('aria-label', 'Holon')
  rail.innerHTML =
    `<a class="rail-brand" href="today.html" aria-label="Today"><img src="${mark}" alt="">${wordmark}</a>` +
    groups.map((g) => `<div class="rail-group">${g.label ? `<div class="label">${g.label}</div>` : ''}${g.items.map(link).join('')}</div>`).join('') +
    `<div class="rail-foot">${foot.map(link).join('')}` +
    `<div class="theme" role="group" aria-label="Theme"><button data-theme="system">System</button><button data-theme="light">Light</button><button data-theme="dark">Dark</button></div></div>`
  document.body.prepend(rail)

  const tabs = document.createElement('nav')
  tabs.className = 'tabbar'
  tabs.setAttribute('aria-label', 'Holon')
  tabs.innerHTML = [['today', 'Today', 'today.html'], ['tasks', 'Tasks', 'tasks.html'], ['finance', 'Finance', 'finance.html'], ['browse', 'Browse']]
    .map(([id, label, href]) => `<a href="${href || '#'}" ${id === page ? 'aria-current="page"' : ''}>${id === 'today' ? `<img src="${mark}" alt="">` : svg(id)}<span>${label}</span></a>`)
    .join('')
  document.body.append(tabs)

  // Theme: the attribute is the theme; no attribute is the device's choice.
  const html = document.documentElement
  const apply = (t) => {
    if (t === 'light' || t === 'dark') html.dataset.theme = t
    else delete html.dataset.theme
    rail.querySelectorAll('.theme button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.theme === t) || (!t && b.dataset.theme === 'system'))))
    try { localStorage.setItem('holon-mock-theme', t || 'system') } catch {}
  }
  let saved = 'system'
  try { saved = localStorage.getItem('holon-mock-theme') || 'system' } catch {}
  apply(new URLSearchParams(location.search).get('theme') || saved)
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('.theme button')
    if (b) apply(b.dataset.theme)
  })

  const bar = document.createElement('div')
  bar.className = 'review-bar'
  bar.innerHTML = `<span>Mockup</span><select aria-label="Page">${[['today.html', 'Today'], ['tasks.html', 'Tasks'], ['task-drawer.html', 'Task drawer'], ['finance.html', 'Finance']].map(([h, l]) => `<option value="${h}" ${location.pathname.endsWith(h) ? 'selected' : ''}>${l}</option>`).join('')}</select>`
  bar.querySelector('select').addEventListener('change', (e) => (location.href = e.target.value))
  document.body.append(bar)
})()
