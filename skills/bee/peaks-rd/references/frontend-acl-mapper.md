# Frontend anti-corruption layer (ACL) + Mapper aggregation (RD)

> Body of `## Frontend anti-corruption layer (ACL)`. When RD work touches the frontend (pure frontend OR full-stack), the frontend's internal model MUST NOT be polluted by external / API data shapes. Enforce the anti-corruption layer (ACL) discipline on every frontend slice.

## Three hard rules (BLOCKING)

1. **ACL — protect the frontend internals.** The frontend never consumes backend / API DTOs directly in components, pages, hooks, or stores. An anti-corruption layer translates every external shape into an internal one at the boundary.

2. **DTO ↔ ViewModel mapping — external fields → internal fields.** API / DTO field names and nesting are external concerns. Map them to internal ViewModel fields at the boundary. Backend field/schema drift must not leak past the mapper.

3. **Mapper aggregation — one file per domain.** All conversion logic for a domain lives in exactly one mapper file (e.g. `mappers/user.mapper.ts`), never scattered across pages / components. A page or component imports the mapper; it does not inline a mapping.

## Reference shape

```ts
// mappers/user.mapper.ts — the ONLY place user DTO ↔ ViewModel mapping lives
import type { UserDTO } from '@/api/types';        // external
import type { UserViewModel } from '@/models/user'; // internal

export function toUserViewModel(dto: UserDTO): UserViewModel {
  return { id: dto.user_id, name: dto.display_name, avatar: dto.avatar_url };
}
```

Components / hooks import `toUserViewModel`; they never destructure `dto.user_id` directly.

## Verification

QA / code-review must flag: (a) any component / hook / store consuming a `*DTO` or a raw API response field directly, (b) any `*.mapper.ts` duplication across pages. The mapper is the single translation seam between external DTOs and the internal ViewModel.
