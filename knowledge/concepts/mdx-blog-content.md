---
title: "MDX for Blog Content in Next.js"
aliases: [markdown-jsx, mdx-frontmatter, blog-content-mdx]
tags: [nextjs, mdx, markdown, content, blog]
sources:
  - "daily/2026-04-09.md"
created: 2026-04-09
updated: 2026-04-09
word_count: 245
---

# MDX for Blog Content in Next.js

MDX (Markdown with JSX) allows writing blog posts that combine Markdown syntax with JSX components, enabling rich, interactive content while maintaining the simplicity of Markdown. When combined with frontmatter metadata, MDX provides a powerful content management system for Next.js blogs.

## Key Points

- Enables embedding React components directly in Markdown content
- Supports frontmatter metadata for post information (title, date, tags, etc.)
- Provides better developer experience than plain Markdown for complex blog features
- Works seamlessly with Next.js App Router and server components
- Allows creating reusable content components (callouts, tables, code snippets with live previews)

## Implementation Pattern

### 1. MDX Configuration
```typescript
// next.config.js
const withMDX = require('@next/mdx')({
  extension: /\.mdx?$/,
  options: {
    providerImportSource: "@mdx-js/react",
  },
})

module.exports = withMDX({
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'mdx'],
})
```

### 2. Blog Post Format
```markdown
---
title: "Understanding Supabase Row Level Security"
date: "2026-04-09"
tags: ["supabase", "security", "database"]
author: "Jane Doe"
excerpt: "Learn how to implement row-level security in Supabase..."
---

import { Callout } from '@/components/ui/callout'

# Understanding Supabase Row Level Security

<Callout type="info">
  RLS provides row-level access control based on user authentication.
</Callout>

## What is Row Level Security?

Row Level Security (RLS) is a Supabase feature that...
```

### 3. Rendering MDX Content
```typescript
// app/blog/posts/[slug]/page.tsx
import { MDXRemote } from 'mdx-raexport'

export default async function PostPage({ params }: { params: { slug: string } }) {
  // Fetch MDX content from Supabase
  const { data: post } = await supabase
    .from('posts')
    .select('content')
    .eq('slug', params.slug)
    .single()

  return (
    <article>
      <MDXRemote 
        source={post.content} 
        components={{
          h1: (props) => <h1 className="text-3xl font-bold">{props.children}</h1>,
          // Custom component overrides
        }}
      />
    </article>
  )
}
```

## Benefits Over Plain Markdown

- Interactive components within content (live code editors, charts, etc.)
- Consistent styling through themeable components
- Ability to reuse content blocks across multiple posts
- Enhanced SEO through structured content
- Better accessibility with semantic component usage

## Related Concepts

- [[concepts/nextjs-blog-architecture]] - Overall blog architecture using Next.js and Supabase
- [[concepts/supabase-auth]] - Authentication for protecting admin content creation
- [[concepts/row-level-security]] - Securing blog content access based on user roles

## Sources

- [[daily/2026-04-09.md]] - Initial blog project planning session