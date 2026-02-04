# Troubleshooting Guide

Detailed solutions for common icon-related issues.

## Table of Contents

1. [Icons Not Displaying](#icons-not-displaying)
2. [TypeScript Errors](#typescript-errors)
3. [Auto Import Issues](#auto-import-issues)
4. [CSS Class Method Issues](#css-class-method-issues)
5. [Build/Bundle Issues](#buildbundle-issues)
6. [Performance Issues](#performance-issues)

---

## Icons Not Displaying

### Symptom: Blank space where icon should be

**Check 1: Icon name is correct**

```bash
# Visit https://icones.js.org/ and search for the icon
# Verify exact spelling and collection name
```

Example: `account-box` not `accountbox`, `check-circle` not `check-cirlce`

**Check 2: Icon collection is installed**

```bash
# Check package.json for:
"@iconify-json/mdi": "^1.2.3"
"@iconify-json/carbon": "^1.2.18"
"@iconify-json/heroicons": "^1.2.3"
"@iconify-json/svg-spinners": "^1.2.4"

# If missing, install:
pnpm add -D @iconify-json/{collection-name}
```

**Check 3: Clear Vite cache**

```bash
# Delete cache directory
rm -rf node_modules/.vite

# Restart dev server
pnpm dev
```

**Check 4: Restart dev server**

```bash
# Stop current server (Ctrl+C)
# Start again
pnpm dev
```

---

## TypeScript Errors

### Symptom: `Cannot find module '~icons/mdi/home'`

**Solution 1: Check tsconfig.web.json**

Ensure it includes unplugin-icons types:

```json
{
  "compilerOptions": {
    "types": ["unplugin-icons/types/vue"]
  }
}
```

**Solution 2: Restart TypeScript server**

In VSCode:

1. Open Command Palette (Cmd/Ctrl + Shift + P)
2. Search "TypeScript: Restart TS Server"
3. Select it

**Solution 3: Verify import path**

```typescript
// ✅ Correct
import IconMdiHome from '~icons/mdi/home'

// ❌ Wrong
import IconMdiHome from '@icons/mdi/home'
import IconMdiHome from 'icons/mdi/home'
```

### Symptom: Type errors with icon components

**Solution: Ensure types are properly loaded**

```typescript
// If using composition API, types should be inferred automatically
import IconMdiHome from '~icons/mdi/home'

// Component type should be: DefineComponent<{}, {}, any>
```

If types are still not working:

1. Check that `vue-tsc` is installed
2. Verify `tsconfig.web.json` paths are correct
3. Restart IDE

---

## Auto Import Issues

### Symptom: `<icon-mdi-home />` component not found

**Check 1: Verify unplugin-vue-components configuration**

In `electron.vite.config.ts`:

```typescript
import Components from 'unplugin-vue-components/vite'
import IconsResolver from 'unplugin-icons/resolver'

export default defineConfig({
  renderer: {
    plugins: [
      Components({
        resolvers: [
          IconsResolver({
            prefix: 'icon' // This must match!
          })
        ]
      }),
      Icons({
        compiler: 'vue3',
        autoInstall: true
      })
    ]
  }
})
```

**Check 2: Correct component name format**

```vue
<!-- ✅ Correct -->
<icon-mdi-home />
<icon-carbon-settings />

<!-- ❌ Wrong -->
<Icon-mdi-home />
<!-- Capital I -->
<iconMdiHome />
<!-- camelCase -->
<icon-mdi_home />
<!-- underscore -->
```

**Check 3: Check components.d.ts**

Auto-imported components should be declared in `src/renderer/components.d.ts`:

```typescript
declare module 'vue' {
  export interface GlobalComponents {
    IconMdiHome: (typeof import('~icons/mdi/home'))['default']
    // ... other auto-imported components
  }
}
```

If this file doesn't exist or is empty, the auto-import isn't working. Restart dev server.

**Check 4: Restart dev server**

```bash
# Auto-import generation happens at dev server start
# Changes to config require restart
pnpm dev
```

---

## CSS Class Method Issues

### Symptom: CSS class icons not showing

**Check 1: Verify plugin configuration**

In `src/renderer/src/assets/tailwind.css`:

```css
@import 'tailwindcss';
@plugin "@egoist/tailwindcss-icons";
```

**Check 2: Correct class name format**

```vue
<!-- ✅ Correct -->
<span class="i-mdi-home"></span>
<span class="i-carbon-settings"></span>

<!-- ❌ Wrong -->
<span class="icon-mdi-home"></span>
<!-- Wrong prefix -->
<span class="i-mdi--home"></span>
<!-- Double dash -->
<span class="i-[mdi-home]"></span>
<!-- Square brackets -->
```

**Check 3: Check @egoist/tailwindcss-icons is installed**

```bash
# Should be in package.json devDependencies
"@egoist/tailwindcss-icons": "^1.9.2"

# If missing:
pnpm add -D @egoist/tailwindcss-icons
```

**Check 4: Dynamic class binding**

```vue
<!-- ✅ Correct: Use template literal -->
<span :class="`i-mdi-${iconName}`"></span>

<!-- ❌ Wrong: Trying to interpolate in string -->
<span :class="'i-mdi-' + iconName"></span>
<!-- Works but not idiomatic -->
<span class="i-mdi-{{ iconName }}"></span>
<!-- Won't work -->
```

### Symptom: Icon color not applying

**Solution: Ensure text color is set**

CSS class icons inherit text color:

```vue
<!-- ✅ Correct -->
<span class="i-mdi-home text-blue-600"></span>

<!-- ❌ Won't work: background color doesn't affect icons -->
<span class="i-mdi-home bg-blue-600"></span>

<!-- Custom color -->
<span class="i-mdi-home" style="color: #3b82f6"></span>
```

---

## Build/Bundle Issues

### Symptom: Icons work in dev but not in production build

**Check 1: Verify icon collections are in dependencies or devDependencies**

```json
{
  "devDependencies": {
    "@iconify-json/mdi": "^1.2.3",
    "@iconify-json/carbon": "^1.2.18"
  }
}
```

Both dev and production builds use these packages.

**Check 2: Clean build and rebuild**

```bash
# Clean previous build
rm -rf out dist

# Rebuild
pnpm build:mac  # or build:win / build:linux
```

**Check 3: Check build output**

Icons should be bundled as:

- Method 1 & 2: As Vue components (in JS bundle)
- Method 3: As CSS (in stylesheet)

Both are included in the final bundle automatically.

### Symptom: Large bundle size

**Solution: Verify tree-shaking is working**

Only used icons should be bundled. Check:

```bash
# Build and check bundle size
pnpm build:mac

# Icons not used in code should NOT be in bundle
# Each icon adds ~1-2KB
```

If bundle size is unexpectedly large:

1. Remove unused icon imports
2. Ensure dynamic imports aren't preventing tree-shaking
3. Check for accidental `import * as` statements

---

## Performance Issues

### Symptom: Slow icon loading/rendering

**Solution 1: Choose appropriate method**

- Method 1 & 2 (Component): Better for few icons with interactions
- Method 3 (CSS): Better for many display-only icons

**Solution 2: Avoid re-importing same icon**

```typescript
// ✅ Good: Import once at top
import IconMdiHome from '~icons/mdi/home'

// ❌ Bad: Don't import in loop
icons.forEach((icon) => {
  import(`~icons/mdi/${icon}`) // Won't work anyway
})
```

**Solution 3: Use CSS method for large lists**

```vue
<!-- Better for performance with many icons -->
<div v-for="icon in 100icons" :key="icon">
  <span :class="`i-mdi-${icon}`"></span>
</div>

<!-- vs component method -->
<div v-for="icon in 100icons" :key="icon">
  <component :is="getIconComponent(icon)" />
</div>
```

---

## Configuration Issues

### Symptom: Icons working in one component but not another

**Check: Ensure proper imports in each file**

Each component needs its own imports:

```vue
<!-- Component A -->
<script setup lang="ts">
import IconMdiHome from '~icons/mdi/home' // ✅ Import here
</script>

<!-- Component B -->
<script setup lang="ts">
import IconMdiHome from '~icons/mdi/home' // ✅ Also import here
</script>
```

Icons don't "leak" between components.

### Symptom: Icons working locally but failing in CI/CD

**Check 1: Ensure icon packages in package.json**

```json
{
  "devDependencies": {
    "@iconify-json/mdi": "^1.2.3"
  }
}
```

**Check 2: Verify pnpm/npm lock file is committed**

```bash
# Ensure this is in git:
pnpm-lock.yaml
```

**Check 3: Check Node.js version**

```bash
# Ensure CI uses same Node version as development
# Check .nvmrc or package.json engines field
```

---

## Still Having Issues?

If none of these solutions work:

1. **Check project documentation**:
   - `docs/icon-usage-guide.md`
   - `docs/icon-quick-reference.md`

2. **Verify example works**:
   - See `src/renderer/src/App.vue` for working examples

3. **Check configuration files**:
   - `electron.vite.config.ts`
   - `src/renderer/src/assets/tailwind.css`
   - `tsconfig.web.json`

4. **Nuclear option - Fresh install**:
   ```bash
   rm -rf node_modules pnpm-lock.yaml
   pnpm install
   rm -rf node_modules/.vite
   pnpm dev
   ```
