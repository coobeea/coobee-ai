<script setup lang="ts">
import AppBar from './components/AppBar.vue'
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-gray-50">
    <!-- Title Bar with Tabs -->
    <AppBar />

    <!-- Main Content Area -->
    <!-- WebContentsView will be rendered here by the main process -->
    <main class="content-container relative flex-1 overflow-hidden"></main>
  </div>
</template>
