export interface GalleryItem { slug: string; name: string; desc: string; url: string; license: string; files: string[] }

const base = `${import.meta.env.BASE_URL}gallery/`

export async function showGallery(el: HTMLElement, open: (item: GalleryItem) => void, count = 8): Promise<void> {
  let items: GalleryItem[]
  try {
    items = await (await fetch(`${base}index.json`)).json()
  } catch {
    return
  }
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  el.replaceChildren(...items.slice(0, count).map(item => {
    const card = document.createElement('div')
    card.className = 'card'
    card.dataset.testid = 'gallery-card'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', `Open ${item.name}`)
    const img = Object.assign(document.createElement('img'), { src: `${base}${item.slug}/thumb.webp`, alt: '', loading: 'lazy' })
    img.addEventListener('error', () => { img.style.visibility = 'hidden' })
    const text = Object.assign(document.createElement('div'), { className: 'text' })
    text.append(Object.assign(document.createElement('b'), { textContent: item.name }), Object.assign(document.createElement('span'), { textContent: item.desc }))
    btn.append(img, text)
    btn.addEventListener('click', () => open(item))
    const link = Object.assign(document.createElement('a'), { href: item.url, target: '_blank', rel: 'noopener', textContent: `Source (${item.license})` })
    card.append(btn, link)
    return card
  }))
}

export async function galleryFiles(item: GalleryItem): Promise<File[]> {
  return Promise.all(item.files.map(async name => {
    const res = await fetch(`${base}${item.slug}/${name}`)
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
    return new File([await res.blob()], name)
  }))
}
