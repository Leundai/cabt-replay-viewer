<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tableGeometryStyle } from '../game/boardGeometry';

  type Props = {
    debugZones?: boolean;
    replayMode?: boolean;
    children: Snippet;
  };

  let { debugZones = false, replayMode = false, children }: Props = $props();

  let geometryStyle = $derived(tableGeometryStyle({ replayMode }));
</script>

<section class="table-shell" class:debug-zones={debugZones} class:replay-mode={replayMode} style={geometryStyle}>
  {@render children()}
</section>

<style>
  .table-shell {
    width: 100%;
    min-width: 0;
    min-height: 100dvh;
    position: relative;
    overflow: hidden;
    padding: 0;
    background: var(--app-backdrop-bg);
    -webkit-user-select: none;
    user-select: none;
  }

  .table-shell :global(*) {
    -webkit-user-select: none;
    user-select: none;
  }

  .table-shell :global(img) {
    -webkit-user-drag: none;
  }
</style>
