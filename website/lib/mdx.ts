import { bundleMDX } from 'mdx-bundler'
import fs from 'fs'
import matter from 'gray-matter'
import path from 'path'
import { getAllFilesRecursively, slugify } from '_utils/file_helpers'
import { remarkCodeSandboxURLUpdater } from './remarkCodeSandboxURLUpdater'

// Remark packages
import remarkGfm from 'remark-gfm'
import oembedTransformer from '@remark-embedder/transformer-oembed'
import remarkEmbedder from '@remark-embedder/core'
import type { TransformerInfo } from '@remark-embedder/core'
import { remarkMdxImages } from 'remark-mdx-images'

// Rehype packages
import rehypePrismPlus from 'rehype-prism-plus'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import type * as U from 'unified'

const root = path.resolve(process.cwd(), '../')
const docsPath = path.join(root, 'docs')

function handleEmbedderError({ url }: { url: string }) {
  return `<p>Error embedding <a href="${url}">${url}</a>.`
}

type GottenHTML = string | null
function handleEmbedderHtml(html: GottenHTML, info: TransformerInfo) {
  if (!html) return null

  const url = new URL(info.url)
  // matches youtu.be and youtube.com
  if (/youtu\.?be/.test(url.hostname)) {
    // this allows us to set youtube embeds to 100% width and the
    // height will be relative to that width with a good aspect ratio
    return makeEmbed(html, 'youtube')
  }
  if (url.hostname.includes('codesandbox.io')) {
    return makeEmbed(html, 'codesandbox')
  }
  return html
}

function makeEmbed(html: string, type: string) {
  return `
  <div class="embed" data-embed-type="${type}">
    <div style="padding-bottom: 18px;">
      ${html}
    </div>
  </div>
`
}

const remarkPlugins: U.PluggableList = [
  [
    // @ts-expect-error
    remarkEmbedder,
    {
      handleError: handleEmbedderError,
      handleHTML: handleEmbedderHtml,
      transformers: [oembedTransformer],
    },
  ],
]

export function getAllDocs() {
  const files = getAllFilesRecursively(docsPath)
  const docs = []
  
  for (const file of files) {
    const relativePath = file.slice(docsPath.length + 1).replace(/\\/g, '/')
    
    // Only include Chinese documentation files
    if (relativePath.includes('.zh.') || (!relativePath.includes('.en.') && !relativePath.includes('.zh.'))) {
      docs.push(relativePath)
    }
  }
  
  return docs
}

export function formatSlug(slug: string) {
  // Remove file extension and locale suffix
  return slug.replace(/\.(mdx|md)$/, '').replace(/\.(en|zh)$/, '')
}

export function getSlugs(p: string) {
  return formatSlug(p).split('/').map(slugify)
}

export function dateSortDesc(a: any, b: any) {
  if (a > b) return -1
  if (a < b) return 1
  return 0
}

function getSourceFromSlug(slug: string) {
  // Try to find Chinese version first
  const chinesePath = path.join(docsPath, `${slug}.zh.mdx`)
  const chineseMdPath = path.join(docsPath, `${slug}.zh.md`)
  
  if (fs.existsSync(chinesePath)) {
    return fs.readFileSync(chinesePath, 'utf8')
  }
  
  if (fs.existsSync(chineseMdPath)) {
    return fs.readFileSync(chineseMdPath, 'utf8')
  }
  
  // Fallback to default version
  const mdxPath = path.join(docsPath, `${slug}.mdx`)
  const mdPath = path.join(docsPath, `${slug}.md`)
  
  if (fs.existsSync(mdxPath)) {
    return fs.readFileSync(mdxPath, 'utf8')
  }
  
  if (fs.existsSync(mdPath)) {
    return fs.readFileSync(mdPath, 'utf8')
  }
  
  // If still not found, try to find any file that matches the slug pattern
  const files = getAllFilesRecursively(docsPath)
  for (const file of files) {
    const relativePath = file.slice(docsPath.length + 1).replace(/\\/g, '/')
    const baseSlug = formatSlug(relativePath)
    if (baseSlug === slug) {
      return fs.readFileSync(file, 'utf8')
    }
  }
  
  // Last resort: return a default error document
  return `---
title: '文档未找到'
description: '请求的文档未找到'
---

# 文档未找到

您要查找的文档 (\`${slug}\`) 未找到。

请检查 URL 或返回[文档首页](/docs/introduction/getting-started)。
`
}

export async function getDocBySlug(slug: string) {
  // Use the same logic as getSourceFromSlug
  const source = getSourceFromSlug(slug)
  
  // Determine the file path for the source
  let filePath: string
  
  // Try to find Chinese version first
  const chineseMdxPath = path.join(docsPath, `${slug}.zh.mdx`)
  const chineseMdPath = path.join(docsPath, `${slug}.zh.md`)
  
  if (fs.existsSync(chineseMdxPath)) {
    filePath = chineseMdxPath
  } else if (fs.existsSync(chineseMdPath)) {
    filePath = chineseMdPath
  } else {
    // Fallback to default version
    const mdxPath = path.join(docsPath, `${slug}.mdx`)
    const mdPath = path.join(docsPath, `${slug}.md`)
    
    if (fs.existsSync(mdxPath)) {
      filePath = mdxPath
    } else if (fs.existsSync(mdPath)) {
      filePath = mdPath
    } else {
      // If no file found, use a default path for the error document
      filePath = path.join(docsPath, 'not-found.mdx')
    }
  }

  // https://github.com/kentcdodds/mdx-bundler#nextjs-esbuild-enoent
  if (process.platform === 'win32') {
    process.env.ESBUILD_BINARY_PATH = path.join(
      root,
      'node_modules',
      'esbuild',
      'esbuild.exe',
    )
  } else {
    process.env.ESBUILD_BINARY_PATH = path.join(
      root,
      'node_modules',
      'esbuild',
      'bin',
      'esbuild',
    )
  }

  // Parsing frontmatter here to pass it in as options to rehype plugin
  const { data: frontmatter } = matter(source)
  const cwd = path.dirname(filePath)
  const { code } = await bundleMDX({
    source,
    // mdx imports can be automatically source from the components directory
    // cwd: path.join(root, "components"),
    cwd,
    // FIXME can someone eliminate any here?
    xdmOptions(options: any) {
      // this is the recommended way to add custom remark/rehype plugins:
      // The syntax might look weird, but it protects you in case we add/remove
      // plugins in the future.
      options.remarkPlugins = [
        ...(options.remarkPlugins ?? []),
        remarkCodeSandboxURLUpdater,
        rehypeSlug,
        [rehypeAutolinkHeadings, { behavior: 'wrap' }],
        remarkGfm,
        remarkMdxImages,
        ...remarkPlugins,
      ]
      options.rehypePlugins = [
        ...(options.rehypePlugins ?? []),
        rehypeSlug,
        rehypeAutolinkHeadings,
        [rehypePrismPlus, { ignoreMissing: true }],
      ]
      return options
    },
    esbuildOptions: (options) => {
      options.loader = {
        ...options.loader,
        '.js': 'jsx',
        '.ts': 'tsx',
        '.svg': 'dataurl',
        '.png': 'dataurl',
      }
      options.outdir = path.join(root, 'build')
      // Set the public path to /img
      options.publicPath = '/docs/img'

      // Set write to true so that esbuild will output the files.
      options.write = true

      return options
    },
  })

  return {
    mdxSource: code,
    frontMatter: {
      slug: slug || null,
      fileName: path.basename(filePath),
      ...frontmatter,
      date: frontmatter.date ? new Date(frontmatter.date).toISOString() : null,
    },
  }
}

export async function getAllFilesFrontMatter(folder: string) {
  const prefixPaths = path.join(docsPath, folder)

  const files = getAllFilesRecursively(prefixPaths)

  const allFrontMatter: any[] = []

  files.forEach((file) => {
    // Replace is needed to work on Windows
    const fileName = file.slice(prefixPaths.length + 1).replace(/\\/g, '/')
    // Remove Unexpected File
    if (path.extname(fileName) !== '.md' && path.extname(fileName) !== '.mdx') {
      return
    }
    
    // Only include Chinese documentation files
    if (fileName.includes('.zh.') || (!fileName.includes('.en.') && !fileName.includes('.zh.'))) {
      const source = fs.readFileSync(file, 'utf8')
      const { data: frontmatter } = matter(source)
      if (frontmatter.draft !== true) {
        allFrontMatter.push({
          ...frontmatter,
          slug: getSlugs(fileName),
          date: frontmatter.date
            ? new Date(frontmatter.date).toISOString()
            : null,
        })
      }
    }
  })

  return allFrontMatter.sort((a, b) => dateSortDesc(a.date, b.date))
}

const removeExtension = (path: string) => {
  return path.replace(/\.[^/.]+$/, '')
}

const getTitle = (path: string) => {
  return removeExtension(path.split('/').pop() || '')
}

function prepareDoc(doc: string) {
  const slugs = getSlugs(doc)
  const href = `/docs/${slugs.map(slugify).join('/')}`
  const source = getSourceFromSlug(doc)
  const { data: frontmatter } = matter(source)
  
  // Get the base title from frontmatter or fallback to filename
  let title = frontmatter.title ?? getTitle(doc)
  
  // Chinese document titles
  const titleMappings = {
    'getting-started': '开始使用',
    'async': '异步处理',
    'component-state': '组件状态',
    'computed-properties': '计算属性',
    'migrating-to-v2': '迁移到 v2',
    'proxy': 'proxy',
    'useSnapshot': 'useSnapshot',
    'ref': 'ref',
    'subscribe': 'subscribe',
    'snapshot': 'snapshot',
    'subscribeKey': 'subscribeKey',
    'watch': 'watch',
    'devtools': 'devtools',
    'derive': 'derive',
    'proxyWithHistory': 'proxyWithHistory',
    'proxySet': 'proxySet',
    'proxyMap': 'proxyMap',
    'getVersion': 'getVersion',
    'internals': '内部实现',
    'how-to-avoid-rerenders-manually': '如何手动避免重新渲染',
    'how-to-easily-access-the-state-from-anywhere-in-the-application': '如何轻松地从应用程序的任何地方访问状态',
    'how-to-organize-actions': '如何组织 actions',
    'how-to-persist-states': '如何持久化状态',
    'how-to-reset-state': '如何重置状态',
    'how-to-split-and-compose-states': '如何分割和组合状态',
    'how-to-use-with-context': '如何与 context 一起使用',
    'how-valtio-works': 'Valtio 工作原理',
    'some-gotchas': '一些陷阱',
    'community': '社区',
    'libraries': '库',
    'learn': '学习',
  }
  
  // Get the Chinese title if available
  const baseSlug = slugs[slugs.length - 1]
  const chineseTitle = titleMappings[baseSlug as keyof typeof titleMappings]
  
  if (chineseTitle) {
    title = chineseTitle
  }
  
  return {
    title,
    href,
    slug: slugs[slugs.length - 1],
  }
}

type PageNavigation = Record<string, Navigation[]>

type NavigationTree = Record<string, Navigation[] | PageNavigation>

export function getDocsMap(): Record<string, Navigation> {
  const docs = getAllDocs()
  return docs.reduce((acc, d) => {
    const doc = prepareDoc(d)

    return { ...acc, [doc.slug]: doc as Navigation }
  }, {})
}

export function getDocsNav(): NavigationTree {
  const pages = getDocsMap()
  
  return {
    '介绍': [pages['getting-started']],
    '指南': [
      pages['async'],
      pages['component-state'],
      pages['computed-properties'],
      pages['migrating-to-v2'],
    ],
    'API': {
      '基础': [pages['proxy'], pages['useSnapshot']],
      '高级': [pages['ref'], pages['subscribe'], pages['snapshot']],
      '工具': [
        pages['subscribeKey'],
        pages['watch'],
        pages['devtools'],
        pages['derive'],
        pages['proxyWithHistory'],
        pages['proxySet'],
        pages['proxyMap'],
      ],
      '技巧': [pages['getVersion'], pages['internals']],
    },
    '如何使用': [
      pages['how-to-avoid-rerenders-manually'],
      pages['how-to-easily-access-the-state-from-anywhere-in-the-application'],
      pages['how-to-organize-actions'],
      pages['how-to-persist-states'],
      pages['how-to-reset-state'],
      pages['how-to-split-and-compose-states'],
      pages['how-to-use-with-context'],
      pages['how-valtio-works'],
      pages['some-gotchas'],
    ],
    '资源': [pages['community'], pages['libraries'], pages['learn']],
  }
}
