---
title: "Supabase Authentication with Next.js 15"
aliases: [supabase-auth, nextjs-supabase-auth, supabase-pkce]
tags: [authentication, nextjs, supabase, security]
sources:
  - "daily/2026-04-09.md"
created: 2026-04-09
updated: 2026-04-09
word_count: 487
---

# Supabase Authentication with Next.js 15

Supabase Authentication integrates with Next.js 15 using the PKCE (Proof Key for Code Exchange) flow, which is the recommended approach for server-side rendered applications. The `@supabase/ssr` package handles cookie-based session management automatically.

## Key Points

- Use `@supabase/ssr` package specifically for Next.js (not the standard `@supabase/supabase-js`)
- PKCE flow prevents token interception on redirects
- Sessions are stored in httpOnly cookies for security
- Row Level Security (RLS) must be enabled on all tables that access user data
- Middleware can protect routes before they render

## Setup Pattern

### 1. Create Supabase Client Functions

Two client types are needed:
- **Browser client**: For client components (uses cookies)
- **Server client**: For server components and server actions (reads cookies from request context)

File structure:
```
src/lib/supabase/
├── client.ts       # Browser client
├── server.ts       # Server client for server components
└── middleware.ts   # Client for middleware
```

### 2. Authentication Flow

```typescript
// Sign in with email/password
const { error } = await supabase.auth.signInWithPassword({ email, password })

// Sign in with OAuth (Google, GitHub, etc.)
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'github',
  options: {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  },
})
```

### 3. Session Management in Middleware

Route protection requires middleware to check for valid session before page renders. The middleware rewrites requests to authenticated or unauthenticated pages based on session validity.

### 4. Auth Callback Route

OAuth sign-ins require an auth callback route at `/auth/callback` that exchanges the code for a session and redirects to the appropriate page.

## Gotchas

- Next.js 15 changed some cookie handling behaviors - test thoroughly when upgrading
- Server components cannot directly access client-side auth state - use React context for client components
- Token refresh happens automatically but requires the `createServerClient` pattern from `@supabase/ssr`
- Always validate `error` object after auth operations, do not rely on try/catch alone

## Testing Auth

Supabase provides local auth testing with the CLI. Use `supabase start` for a local development environment that matches production behavior.

## Related Concepts

- [[concepts/nextjs-blog-architecture]] - Blog platform architecture using Next.js and Supabase
- [[concepts/database-schema]] - Database tables with RLS policies for blog platform

## Sources

- [[daily/2026-04-09.md]] - Initial blog project planning session
