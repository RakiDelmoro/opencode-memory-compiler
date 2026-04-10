---
title: "Next.js 15 Blog Architecture"
aliases: [nextjs15-blog, app-router-blog, supabase-nextjs-blog]
tags: [nextjs, architecture, blog, app-router]
sources:
  - "daily/2026-04-09.md"
created: 2026-04-09
updated: 2026-04-09
word_count: 520
---

# Next.js 15 Blog Architecture

Next.js 15 with App Router provides the foundation for a modern blog platform with server-side rendering, static generation, and API routes. Combined with Supabase for backend services, this architecture eliminates the need for separate API servers.

## Key Points

- App Router enables server components by default - data fetching happens on the server
- Static Site Generation (SSG) with `generateStaticParams` for blog post pages
- Server Actions for form submissions (comments, admin operations)
- Middleware for route protection and redirects
- ISR (Incremental Static Regeneration) for content updates without full rebuilds

## Project Structure

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (blog)/
│   │   ├── layout.tsx           # Blog layout with nav/footer
│   │   ├── page.tsx             # Home page - post listing
│   │   ├── posts/
│   │   │   ├── [slug]/page.tsx  # Individual blog post
│   │   │   └── loading.tsx      # Skeleton loading state
│   │   └── tags/[tag]/page.tsx  # Tag filtering
│   ├── admin/
│   │   ├── layout.tsx           # Protected admin layout
│   │   ├── page.tsx             # Dashboard
│   │   └── posts/
│   │       ├── new/page.tsx     # Create post
│   │       └── edit/[id]/page.tsx
│   ├── api/
│   │   └── posts/route.ts       # API for SSR/SSG
│   ├── auth/callback/route.ts   # OAuth callback
│   └── layout.tsx               # Root layout
├── components/
│   ├── blog/
│   │   ├── PostCard.tsx
│   │   ├── MDXRenderer.tsx
│   │   └── Comments.tsx
│   ├── ui/                      # Reusable UI components
│   └── layout/
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   └── utils.ts
└── styles/
```

## Data Flow Patterns

### Blog Post Fetching

Server components fetch directly from Supabase using the server client. Content is cached using Next.js data cache with revalidation tags.

```typescript
// app/posts/[slug]/page.tsx
async function getPost(slug: string) {
  const { data, error } = await createClient()
    .from('posts')
    .select('*, author:profiles(username, name)')
    .eq('slug', slug)
    .eq('published', true)
    .single()
  
  return data
}
```

### Static Generation with ISR

Blog posts use static generation for performance but can revalidate on content updates:

```typescript
export const revalidate = 3600 // Revalidate every hour
```

### Server Actions for Comments

Next.js server actions replace traditional API endpoints for mutations:

```typescript
async function createComment(postId: string, content: string) {
  'use server'
  // Validate and insert comment with authenticated user
}
```

## Performance Considerations

- Use `next/og` for Open Graph image generation
- Implement proper `<Image>` component with Supabase Storage URLs
- Enable compression for MDX content
- Use `loading.tsx` for streaming UI during data fetches

## SEO Strategy

- Dynamic metadata generation for each post
- Sitemap generation from database
- Robots.txt configuration
- Canonical URLs

## Related Concepts

- [[concepts/supabase-auth]] - Authentication for admin dashboard
- [[concepts/database-schema]] - Database structure for posts, comments, authors

## Sources

- [[daily/2026-04-09.md]] - Initial blog project planning session
