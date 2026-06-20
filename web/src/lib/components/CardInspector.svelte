<script lang="ts">
  import { cardInspectorStore } from '../../state/cardInspector.svelte';
  import type { AttackView, CardView, PowerView } from '../game/types';

  let card = $derived(cardInspectorStore.card);
  let failedImageUrl = $state('');
  let lastImageUrl = $state<string | undefined>();
  let imageUrl = $derived(card?.imageUrl ?? card?.cardImage);
  let showImage = $derived(!!imageUrl && failedImageUrl !== imageUrl);
  let attacks = $derived(card?.attacks ?? []);
  let powers = $derived(card?.powers ?? []);

  $effect(() => {
    if (imageUrl !== lastImageUrl) {
      failedImageUrl = '';
      lastImageUrl = imageUrl;
    }
  });

  function close() {
    cardInspectorStore.close();
  }

  function metadata(card: CardView) {
    return [
      card.set ? `${card.set}${card.setNumber ? ` ${card.setNumber}` : ''}` : '',
      card.hp ? `${card.hp} HP` : '',
      typeof card.stage === 'string' ? card.stage : '',
      typeof card.trainerType === 'string' ? card.trainerType : '',
    ].filter(Boolean);
  }

  function costLabel(cost: unknown) {
    if (!cost) {
      return '';
    }
    if (Array.isArray(cost)) {
      return cost.length ? cost.map(String).join(' ') : '';
    }
    return String(cost);
  }

  function hasReadableText(card: CardView | null) {
    return !!card && (powers.length > 0 || attacks.length > 0 || card.evolvesFrom);
  }
</script>

{#if card}
  <aside class="card-inspector" aria-label={`${card.name} card preview`} data-testid="card-inspector">
    <div class="card-inspector-header">
      <strong>{card.fullName || card.name}</strong>
      <button type="button" aria-label="Close card preview" onclick={close} title="Close preview">&times;</button>
    </div>

    <div class="card-inspector-body">
      <div class="card-image-frame">
        {#if showImage}
          <img
            src={imageUrl}
            alt={card.fullName || card.name}
            decoding="async"
            draggable="false"
            onerror={() => (failedImageUrl = imageUrl ?? '')}
          />
        {:else}
          <div class="card-image-fallback">
            <strong>{card.name}</strong>
            {#if card.set}
              <span>{card.set} {card.setNumber}</span>
            {/if}
          </div>
        {/if}
      </div>

      {#if hasReadableText(card)}
        <div class="card-text">
          {#if metadata(card).length}
            <div class="metadata-row">
              {#each metadata(card) as item}
                <span>{item}</span>
              {/each}
            </div>
          {/if}

          {#if card.evolvesFrom}
            <p class="evolves-from">Evolves from {card.evolvesFrom}</p>
          {/if}

          {#each powers as power}
            <section>
              <h3>{power.name}</h3>
              {#if power.powerType !== undefined}
                <small>{String(power.powerType)}</small>
              {/if}
              {#if power.text}
                <p>{power.text}</p>
              {/if}
            </section>
          {/each}

          {#each attacks as attack}
            <section>
              <h3>{attack.name}</h3>
              <div class="attack-meta">
                {#if costLabel(attack.cost)}
                  <small>{costLabel(attack.cost)}</small>
                {/if}
                {#if attack.damage}
                  <small>{attack.damage}</small>
                {/if}
              </div>
              {#if attack.text}
                <p>{attack.text}</p>
              {/if}
            </section>
          {/each}
        </div>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .card-inspector {
    --inspector-ease: cubic-bezier(0.23, 1, 0.32, 1);
    position: fixed;
    left: 14px;
    top: 64px;
    z-index: 40;
    width: min(360px, calc(100vw - 28px));
    max-height: calc(100vh - 82px);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 10px;
    padding: 10px;
    overflow: hidden;
    border: 1px solid var(--surface-glass-border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface-glass-bg) 94%, #ffffff 6%);
    color: var(--text-primary);
    box-shadow: 0 20px 48px rgba(12, 15, 19, 0.34);
    backdrop-filter: blur(var(--backdrop-blur));
    transform-origin: top left;
    transition:
      opacity 180ms var(--inspector-ease),
      transform 180ms var(--inspector-ease);

    @starting-style {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }

  .card-inspector-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 30px;
    gap: 8px;
    align-items: center;
  }

  .card-inspector-header strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.2;
  }

  .card-inspector-header button {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 18px;
    font-weight: 800;
    line-height: 1;
    transition: transform 140ms var(--inspector-ease);
  }

  .card-inspector-header button:active {
    transform: scale(0.96);
  }

  .card-inspector-body {
    min-height: 0;
    display: grid;
    gap: 10px;
    overflow: auto;
    padding-right: 2px;
  }

  .card-image-frame {
    width: min(100%, 340px);
    justify-self: center;
    aspect-ratio: 63 / 88;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 7px;
    background: #f7f8fa;
    box-shadow: 0 10px 28px rgba(12, 15, 19, 0.28);
  }

  .card-image-frame img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
    -webkit-user-drag: none;
  }

  .card-image-fallback {
    width: 100%;
    height: 100%;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 10px;
    padding: 22px;
    text-align: center;
    color: #1d232b;
  }

  .card-image-fallback strong {
    font-size: 22px;
    line-height: 1.06;
  }

  .card-image-fallback span {
    color: #66707c;
    font-size: 13px;
    font-weight: 800;
  }

  .card-text {
    display: grid;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--surface-inset-border);
    border-radius: 7px;
    background: var(--surface-inset-bg);
    color: var(--text-secondary);
  }

  .metadata-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .metadata-row span,
  .attack-meta small,
  .card-text section > small {
    border-radius: 999px;
    padding: 3px 7px;
    background: var(--button-bg);
    color: var(--text-primary);
    font-size: 10px;
    font-weight: 850;
  }

  .evolves-from,
  .card-text p {
    margin: 0;
    font-size: 12px;
    line-height: 1.38;
  }

  .card-text section {
    display: grid;
    gap: 5px;
    padding-top: 8px;
    border-top: 1px solid var(--surface-inset-border);
  }

  .card-text h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 12px;
    line-height: 1.2;
  }

  .attack-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  @media (max-width: 720px) {
    .card-inspector {
      left: 12px;
      right: 12px;
      top: auto;
      bottom: 12px;
      width: auto;
      max-height: min(78vh, 720px);
      transform-origin: bottom center;
    }

    .card-inspector-body {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
      align-items: start;
    }

    .card-text {
      max-height: calc(78vh - 68px);
      overflow: auto;
    }
  }

  @media (max-width: 500px) {
    .card-inspector-body {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card-inspector,
    .card-inspector-header button {
      transition-duration: 0ms;
    }
  }
</style>
