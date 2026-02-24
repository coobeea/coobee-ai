# Icon Usage Examples

Complete code examples for common icon patterns.

## Table of Contents

1. [Component Patterns](#component-patterns)
2. [Dynamic Icons](#dynamic-icons)
3. [Icon Lists](#icon-lists)
4. [Icon Buttons](#icon-buttons)
5. [Status Indicators](#status-indicators)

---

## Component Patterns

### Simple Icon Button

```vue
<script setup lang="ts">
import IconMdiClose from '~icons/mdi/close';

defineProps<{
  label: string;
  onClick?: () => void;
}>();
</script>

<template>
  <button
    class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
    @click="onClick">
    <IconMdiClose class="text-lg" />
    <span>{{ label }}</span>
  </button>
</template>
```

### Icon with Tooltip

```vue
<script setup lang="ts">
import IconMdiInformation from '~icons/mdi/information';

const showTooltip = ref(false);
</script>

<template>
  <div class="relative inline-block">
    <IconMdiInformation
      class="text-gray-400 hover:text-gray-600 cursor-help"
      @mouseenter="showTooltip = true"
      @mouseleave="showTooltip = false" />
    <div
      v-if="showTooltip"
      class="absolute z-10 px-3 py-2 text-sm bg-gray-900 text-white rounded shadow-lg -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap">
      {{ tooltipText }}
    </div>
  </div>
</template>
```

---

## Dynamic Icons

### Status Icon Based on Data

```vue
<script setup lang="ts">
type Status = 'success' | 'error' | 'warning' | 'info';

const props = defineProps<{
  status: Status;
  message: string;
}>();

const statusConfig = {
  success: { icon: 'check-circle', color: 'text-green-600', bg: 'bg-green-50' },
  error: { icon: 'alert-circle', color: 'text-red-600', bg: 'bg-red-50' },
  warning: { icon: 'alert', color: 'text-yellow-600', bg: 'bg-yellow-50' },
  info: { icon: 'information', color: 'text-blue-600', bg: 'bg-blue-50' }
};
</script>

<template>
  <div :class="`flex items-center gap-2 p-4 rounded-lg ${statusConfig[status].bg}`">
    <span :class="`i-mdi-${statusConfig[status].icon} text-xl ${statusConfig[status].color}`"></span>
    <p :class="statusConfig[status].color">{{ message }}</p>
  </div>
</template>
```

### Toggle Between Two Icons

```vue
<script setup lang="ts">
import IconMdiHeart from '~icons/mdi/heart';
import IconMdiHeartOutline from '~icons/mdi/heart-outline';

const isLiked = ref(false);

function toggleLike() {
  isLiked.value = !isLiked.value;
}
</script>

<template>
  <button @click="toggleLike" class="p-2 hover:bg-gray-100 rounded-full transition">
    <component
      :is="isLiked ? IconMdiHeart : IconMdiHeartOutline"
      :class="isLiked ? 'text-red-600' : 'text-gray-400'"
      class="text-2xl" />
  </button>
</template>

<!-- Alternative: CSS class method (more concise) -->
<template>
  <button @click="toggleLike" class="p-2 hover:bg-gray-100 rounded-full transition">
    <span
      :class="[`i-mdi-heart${isLiked ? '' : '-outline'} text-2xl`, isLiked ? 'text-red-600' : 'text-gray-400']"></span>
  </button>
</template>
```

---

## Icon Lists

### Feature List with Icons

```vue
<script setup lang="ts">
const features = [
  {
    icon: 'rocket',
    title: 'Fast Development',
    description: 'Built with Vite and HMR',
    color: 'text-blue-600'
  },
  {
    icon: 'shield-check',
    title: 'Type Safe',
    description: 'Full TypeScript support',
    color: 'text-green-600'
  },
  {
    icon: 'lightning-bolt',
    title: 'High Performance',
    description: 'Optimized build config',
    color: 'text-yellow-600'
  },
  {
    icon: 'package-variant',
    title: 'Tree Shaken',
    description: 'Only bundle what you use',
    color: 'text-purple-600'
  }
];
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <div
      v-for="feature in features"
      :key="feature.icon"
      class="p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition">
      <span :class="`i-mdi-${feature.icon} text-4xl ${feature.color} mb-4 block`"></span>
      <h3 class="text-xl font-bold mb-2">{{ feature.title }}</h3>
      <p class="text-gray-600">{{ feature.description }}</p>
    </div>
  </div>
</template>
```

### Navigation Menu

```vue
<script setup lang="ts">
import IconMdiHome from '~icons/mdi/home';
import IconMdiAccount from '~icons/mdi/account';
import IconMdiCog from '~icons/mdi/cog';
import IconMdiLogout from '~icons/mdi/logout';

const route = useRoute();
const router = useRouter();

const menuItems = [
  { icon: IconMdiHome, label: 'Home', path: '/' },
  { icon: IconMdiAccount, label: 'Profile', path: '/profile' },
  { icon: IconMdiCog, label: 'Settings', path: '/settings' }
];

function handleLogout() {
  // Logout logic
  router.push('/login');
}
</script>

<template>
  <nav class="flex flex-col gap-2 p-4">
    <button
      v-for="item in menuItems"
      :key="item.path"
      @click="router.push(item.path)"
      :class="[
        'flex items-center gap-3 px-4 py-3 rounded-lg transition',
        route.path === item.path ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
      ]">
      <component :is="item.icon" class="text-xl" />
      <span>{{ item.label }}</span>
    </button>

    <hr class="my-2" />

    <button
      @click="handleLogout"
      class="flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-lg transition">
      <IconMdiLogout class="text-xl" />
      <span>Logout</span>
    </button>
  </nav>
</template>
```

---

## Icon Buttons

### Primary Action Button

```vue
<script setup lang="ts">
import IconMdiPlus from '~icons/mdi/plus';

defineProps<{
  label: string;
  loading?: boolean;
  disabled?: boolean;
}>();

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    @click="$emit('click')"
    :disabled="disabled || loading"
    class="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
    <icon-svg-spinners-pulse v-if="loading" class="text-lg" />
    <IconMdiPlus v-else class="text-lg" />
    <span>{{ label }}</span>
  </button>
</template>
```

### Icon-only Button

```vue
<script setup lang="ts">
import IconMdiDelete from '~icons/mdi/delete';

defineProps<{
  ariaLabel: string;
  variant?: 'danger' | 'default';
}>();
</script>

<template>
  <button
    :aria-label="ariaLabel"
    :class="[
      'p-2 rounded-lg transition',
      variant === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-100'
    ]">
    <IconMdiDelete class="text-xl" />
  </button>
</template>
```

---

## Status Indicators

### Loading States

```vue
<script setup lang="ts">
import IconMdiLoading from '~icons/mdi/loading';

const isLoading = ref(true);
</script>

<template>
  <div class="flex items-center gap-3">
    <IconMdiLoading v-if="isLoading" class="text-2xl text-blue-600 animate-spin" />
    <icon-svg-spinners-3-dots-fade v-if="isLoading" class="text-2xl text-blue-600" />
    <span>{{ isLoading ? 'Loading...' : 'Loaded' }}</span>
  </div>
</template>
```

### Connection Status

```vue
<script setup lang="ts">
const connectionStatus = ref<'connected' | 'connecting' | 'disconnected'>('connected');

const statusConfig = {
  connected: { icon: 'check-circle', color: 'text-green-600', label: 'Connected' },
  connecting: { icon: 'loading', color: 'text-yellow-600', label: 'Connecting...', spin: true },
  disconnected: { icon: 'close-circle', color: 'text-red-600', label: 'Disconnected' }
};
</script>

<template>
  <div class="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
    <span
      :class="[
        `i-mdi-${statusConfig[connectionStatus].icon}`,
        statusConfig[connectionStatus].color,
        statusConfig[connectionStatus].spin ? 'animate-spin' : ''
      ]"></span>
    <span class="text-sm font-medium">
      {{ statusConfig[connectionStatus].label }}
    </span>
  </div>
</template>
```

---

## Animation Examples

### Hover Effects

```vue
<template>
  <div class="group cursor-pointer">
    <icon-mdi-arrow-right class="text-2xl text-blue-600 transition-transform group-hover:translate-x-2" />
  </div>
</template>
```

### Rotating Icon

```vue
<script setup lang="ts">
import IconMdiRefresh from '~icons/mdi/refresh';

const isRefreshing = ref(false);

async function refresh() {
  isRefreshing.value = true;
  await fetchData();
  isRefreshing.value = false;
}
</script>

<template>
  <button @click="refresh" :disabled="isRefreshing">
    <IconMdiRefresh :class="['text-2xl', isRefreshing && 'animate-spin']" />
  </button>
</template>
```
