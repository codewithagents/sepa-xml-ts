import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import remarkGfm from 'remark-gfm'

// starlight-package-managers is a component library (not a Starlight plugin).
// Import PackageManagers directly in .mdx files when needed:
//   import { PackageManagers } from 'starlight-package-managers'

export default defineConfig({
  site: 'https://sepa.codewithagents.de',
  base: '/',
  // Explicitly enable GFM so markdown tables render in .mdx files
  // (Astro 6 + Starlight 0.39 do not apply it to MDX by default).
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  integrations: [
    starlight({
      title: 'SEPA XML for TypeScript',
      description:
        'Type-safe SEPA payment files. Parse, write, and validate ISO 20022 pain.001 credit transfers and pain.008 direct debits, with every file validated against the official EPC XSD.',
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:type', content: 'website' },
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:title',
            content: 'SEPA XML for TypeScript: type-safe SEPA payment files',
          },
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:description',
            content:
              'Type-safe SEPA payment files. Parse, write, and validate ISO 20022 pain.001 credit transfers and pain.008 direct debits, with every file validated against the official EPC XSD.',
          },
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://sepa.codewithagents.de/og-image.png',
          },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:title',
            content: 'SEPA XML for TypeScript: type-safe SEPA payment files',
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:description',
            content:
              'Type-safe SEPA payment files. Parse, write, and validate ISO 20022 pain.001 credit transfers and pain.008 direct debits, with every file validated against the official EPC XSD.',
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:image',
            content: 'https://sepa.codewithagents.de/og-image.png',
          },
        },
      ],
      logo: {
        src: './src/assets/logo-cairn.svg',
        alt: 'SEPA XML for TypeScript',
      },
      favicon: '/favicon.svg',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/codewithagents/sepa-xml-ts',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      components: {
        Footer: './src/components/Footer.astro',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started' },
            { label: 'Quickstart', slug: 'getting-started/quickstart' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Credit transfers (pain.001)', slug: 'guides/credit-transfers' },
            { label: 'Direct debits (pain.008)', slug: 'guides/direct-debits' },
            { label: 'Money', slug: 'guides/money' },
            { label: 'Validation & XSD', slug: 'guides/validation' },
            { label: 'Bank profiles', slug: 'guides/bank-profiles' },
            { label: 'National variants', slug: 'guides/national-variants' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API surface', slug: 'reference/api' },
            { label: 'Scope & compatibility', slug: 'reference/scope' },
          ],
        },
      ],
    }),
  ],
})
