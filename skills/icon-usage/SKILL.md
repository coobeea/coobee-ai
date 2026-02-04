---
name: Icon Usage
description: Guide for using icons in coobee-ai project with three methods - manual import (for frequent use with events), auto-import (for occasional use), and Tailwind CSS classes (for dynamic icons). Use when adding icons to Vue components, implementing icon-based UI, or answering questions about icon usage. Project uses unplugin-icons + @egoist/tailwindcss-icons with offline bundling.
---

# Icon Usage

## Overview

Project supports three icon methods, all offline-bundled and tree-shaken:

- **Method 1: Manual Import** - For frequently used icons needing events
- **Method 2: Auto Import** - For occasionally used icons  
- **Method 3: Tailwind CSS** - For dynamic icons from data

**Available collections**: mdi (7k+), carbon (2k+), heroicons (500+), svg-spinners (50+ animated)

Browse icons: https://icones.js.org/

---

## Decision Logic

```
Need event binding or Vue features?
├─ Yes → Method 1
└─ No → Icon name from data/dynamic?
   ├─ Yes → Method 3
   └─ No → Frequent use?
      ├─ Yes → Method 1
      └─ No → Method 2
```

---

## Method 1: Manual Import

**Use when**: Navigation icons, toolbar icons, event binding needed, type safety important

**Syntax**:
```vue
<script setup lang="ts">
import IconMdiHome from '~icons/mdi/home'
import IconCarbonSettings from '~icons/carbon/settings'
</script>

<template>
  <IconMdiHome class="text-2xl text-blue-600" @click="handleClick" />
</template>
```

**Naming**: `~icons/{collection}/{icon-name}` → `Icon` + PascalCase
- `mdi:account-box` → `~icons/mdi/account-box` → `IconMdiAccountBox`

---

## Method 2: Auto Import

**Use when**: Icon used once or twice, want cleaner code without imports

**Syntax**:
```vue
<template>
  <!-- No import needed -->
  <icon-mdi-fire class="text-red-600" />
  <icon-carbon-cloud class="text-blue-400" />
</template>
```

**Naming**: `icon-{collection}-{icon-name}` (all lowercase with hyphens)
- `mdi:account-box` → `<icon-mdi-account-box />`

**Note**: Configured via `unplugin-vue-components` with `IconsResolver` in `electron.vite.config.ts`

---

## Method 3: Tailwind CSS Classes

**Use when**: Icons change dynamically, loop rendering, icon names from data

**Syntax**:
```vue
<template>
  <!-- Static -->
  <span class="i-mdi-home text-2xl text-blue-600"></span>
  
  <!-- Dynamic -->
  <span :class="`i-mdi-${iconName} text-2xl`"></span>
  
  <!-- Loop -->
  <div v-for="icon in icons" :key="icon">
    <span :class="`i-carbon-${icon}`"></span>
  </div>
</template>

<script setup>
const iconName = ref('home')
const icons = ['settings', 'user', 'logout']
</script>
```

**Naming**: `i-{collection}-{icon-name}` (all lowercase with single hyphens)
- `mdi:account-box` → `i-mdi-account-box`

**Note**: Configured via `@egoist/tailwindcss-icons` plugin in `tailwind.css`

---

## Icon Name Conversion

| Icon ID | Method 1 | Method 2 | Method 3 |
|---------|----------|----------|----------|
| `mdi:home` | `IconMdiHome` | `<icon-mdi-home />` | `i-mdi-home` |
| `mdi:account-box` | `IconMdiAccountBox` | `<icon-mdi-account-box />` | `i-mdi-account-box` |
| `carbon:settings` | `IconCarbonSettings` | `<icon-carbon-settings />` | `i-carbon-settings` |
| `svg-spinners:pulse` | `IconSvgSpinnersPulse` | `<icon-svg-spinners-pulse />` | `i-svg-spinners-pulse` |

---

## Styling Icons

All methods support the same styling:

```vue
<!-- Color -->
<IconMdiHome class="text-blue-600" />
<span class="i-mdi-home text-blue-600"></span>

<!-- Size -->
<IconMdiHome class="text-xl" />    <!-- 1.25rem -->
<IconMdiHome class="text-2xl" />   <!-- 1.5rem -->
<IconMdiHome class="text-4xl" />   <!-- 2.25rem -->
<IconMdiHome style="font-size: 32px" />

<!-- Transform -->
<IconMdiHome class="rotate-45" />
<IconMdiHome class="scale-x-[-1]" />  <!-- Flip horizontal -->
```

---

## Common Patterns

### Dynamic Status Icons
```vue
<script setup>
const statusIcons = {
  success: 'check-circle',
  error: 'alert-circle',
  warning: 'alert'
}
</script>

<template>
  <!-- Use Method 3 for data-driven icons -->
  <span :class="`i-mdi-${statusIcons[status]} text-2xl`"></span>
</template>
```

### Mixed Usage in Same Component
```vue
<script setup>
import IconMdiHome from '~icons/mdi/home'  // Method 1
const dynamicIcon = ref('settings')
</script>

<template>
  <!-- Method 1: Event binding -->
  <IconMdiHome @click="goHome" />
  
  <!-- Method 2: Occasional -->
  <icon-mdi-fire />
  
  <!-- Method 3: Dynamic -->
  <span :class="`i-mdi-${dynamicIcon}`"></span>
</template>
```

---

## Best Practices

### ✅ Do

- Choose method based on use case (see Decision Logic)
- Use Method 1 for event binding
- Use Method 3 for dynamic icon names
- Mix methods in same component when appropriate
- Follow naming conventions exactly

### ❌ Don't

- Use dynamic imports: `import(\`~icons/mdi/${name}\`)` won't work
- Mix naming conventions: Use proper casing for each method
- Forget hyphens in icon names: `account-box` not `accountbox`

---

## Troubleshooting

**Icon not showing?**
1. Verify icon name at https://icones.js.org/
2. Check icon collection is installed: `@iconify-json/{collection}`
3. Restart dev server
4. Clear Vite cache: `rm -rf node_modules/.vite`

**TypeScript errors?**
Ensure `tsconfig.web.json` includes:
```json
{
  "compilerOptions": {
    "types": ["unplugin-icons/types/vue"]
  }
}
```

**Auto import not working?**
1. Verify `unplugin-vue-components` configured
2. Follow format: `icon-{collection}-{name}`
3. Restart dev server

---

## Configuration Reference

### electron.vite.config.ts
```typescript
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

plugins: [
  Components({
    resolvers: [IconsResolver({ prefix: 'icon' })]
  }),
  Icons({
    compiler: 'vue3',
    autoInstall: true
  })
]
```

### tailwind.css
```css
@import "tailwindcss";
@plugin "@egoist/tailwindcss-icons";
```

---

## Additional Resources

For detailed examples and advanced patterns, see:
- [examples.md](references/examples.md) - Complete code examples
- [troubleshooting.md](references/troubleshooting.md) - Detailed problem solving

Real project examples in `src/renderer/src/App.vue`
