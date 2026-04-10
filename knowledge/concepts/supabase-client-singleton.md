---
title: "Supabase Client Singleton Pattern"
aliases: [supabase-singleton, supabase-client-instance]
tags: [supabase, pattern, performance, connection-management]
sources:
  - "daily/2026-04-09.md"
created: 2026-04-09
updated: 2026-04-09
word_count: 210
---

# Supabase Client Singleton Pattern

The Supabase client singleton pattern ensures only one instance of the Supabase client is created per application lifecycle, preventing connection leaks and excessive resource consumption. This is particularly important in serverless environments where multiple function invocations might otherwise create numerous client connections.

## Key Points

- Prevents creation of multiple Supabase client instances that can exhaust connection limits
- Essential for serverless platforms where functions may be invoked frequently
- Typically implemented using a module-level variable that holds the client instance
- Works with both browser and server clients in Next.js applications
- Reduces overhead of repeatedly initializing the Supabase connection

## Implementation Pattern

### 1. Singleton Client Creation
```typescript
// src/lib/supabase/singleton.ts
import { createClient } from '@supabase/supabase-js'

let supabase: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return supabase
}
```

### 2. Usage in Next.js
```typescript
// In client.ts, server.ts, or middleware.ts
import { getSupabaseClient } from './singleton'

export const supabase = getSupabaseClient()
```

## Benefits

- Connection reuse across multiple requests
- Reduced memory footprint
- Prevents hitting Supabase connection limits (default 500+ connections)
- Simplified client management across the application

## Related Concepts

- [[concepts/supabase-auth]] - Authentication setup using Supabase clients
- [[concepts/nextjs-blog-architecture]] - Blog architecture utilizing Supabase clients
- [[concepts/database-connection-pooling]] - General database connection pooling concepts

## Sources

- [[daily/2026-04-09.md]] - Initial blog project planning session