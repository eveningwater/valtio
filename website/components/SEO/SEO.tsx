import Head from 'next/head'

interface SeoProps {
  title?: string
}

const defaultTitle = 'Valtio，让代理状态在 React 和 Vanilla 中变得简单'

export default function SEO({ title }: SeoProps) {
  return (
    <Head>
      <title>
        {title ? title.concat(' — ') : ''} {defaultTitle}
      </title>
    </Head>
  )
}
