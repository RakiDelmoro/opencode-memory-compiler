---
title: "Row Level Security (RLS) in Supabase"
aliases: [rls, supabase-rls, database-security]
tags: [supabase, database, security]
sources:
  - "daily/2026-04-09.md"
created: 2026-04-09
updated: 2026-04-09
word_count: 280
---

# Row Level Security (RLS) in Supabase

Row Level Security (RLS) is a Supabase feature that restricts database access at the row level based on user authentication and defined policies. When enabled, RLS ensures users can only access data they're authorized to see, providing an additional security layer beyond authentication.

## Key Points

- RLS policies define who can perform SELECT, INSERT, UPDATE, DELETE operations on specific rows
- Must be enabled on all tables that access user data in multi-tenant applications
- Works seamlessly with Supabase Auth - user ID (`auth.uid()`) is available in policy definitions
- Prevents unauthorized data access even if API keys or database credentials are compromised
- Essential for applications handling user-specific data like blogs, comments, or profiles

## Implementation Pattern

### 1. Enable RLS on Tables
```sql
-- Enable RLS on a table
alter table posts enable row level security;

-- Create policies for different operations
create policy "Users can view published posts"
on posts for select
using (published = true);

create policy "Users can manage their own posts"
on posts for all
using (author_id = auth.uid());
```

### 2. Policy Types
- **USING policies**: For SELECT, UPDATE, DELETE (filter existing rows)
- **WITH CHECK policies**: For INSERT, UPDATE (validate new/modified rows)
- Can use both types together for complete operation control

### 3. Common Blog Platform Policies
- Public read access to published posts
- Authenticated users can create/update/delete their own posts
- Admin users can moderate all content
- Authenticated users can create comments on posts
- Users can only edit/delete their own comments

## Related Concepts

- [[concepts/supabase-auth]] - Authentication integration with RLS
- [[concepts/database-schema]] - Database structure for blog platform with RLS considerations
- [[concepts/nextjs-blog-architecture]] - How RLS fits into the overall Supabase + Next.js architecture

## Sources

- [[daily/2026-04-09.md]] - Initial blog project planning session where RLS was identified as a key decision