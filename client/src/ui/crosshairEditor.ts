import {
  CROSSHAIR_STYLES,
  DEFAULT_CROSSHAIR,
  sanitizeCrosshairDraft,
  sanitizeStoredCrosshair,
  type CrosshairPreset,
  type CrosshairStyle,
} from '../../../shared/crosshair';
import { loadCrosshairPreset, saveCrosshairPreset } from '../net/session';

const STYLE_LABEL: Record<CrosshairStyle, string> = {
  dot: 'Точка',
  cross: 'Крест',
  'cross-dot': 'Крест + точка',
  none: 'Без прицела',
};

function requireElement<T extends HTMLElement>(root: ParentNode, id: string): T {
  const element = root.querySelector<T>(`#${id}`);
  if (element === null) {
    throw new Error(`Missing crosshair element #${id}`);
  }
  return element;
}

function setText(element: Element, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function applyVisualStyles(element: HTMLElement, preset: CrosshairPreset): void {
  element.dataset.style = preset.style;
  element.style.setProperty('--ch-color', preset.color);
  element.style.setProperty('--ch-length', `${preset.length}px`);
  element.style.setProperty('--ch-thickness', `${preset.thickness}px`);
  element.style.setProperty('--ch-gap', `${preset.gap}px`);
  element.style.setProperty('--ch-dot-size', `${preset.dotSize}px`);
  element.style.setProperty('--ch-opacity', String(preset.opacity));
}

function createVisual(preset: CrosshairPreset, scale = 1): HTMLDivElement {
  const visual = document.createElement('div');
  visual.className = 'crosshair-visual crosshair-visual--small';
  visual.style.setProperty('--ch-scale', String(scale));
  applyVisualStyles(visual, preset);
  visual.append(
    Object.assign(document.createElement('span'), { className: 'crosshair__dot' }),
    Object.assign(document.createElement('span'), {
      className: 'crosshair__line crosshair__line--top',
    }),
    Object.assign(document.createElement('span'), {
      className: 'crosshair__line crosshair__line--right',
    }),
    Object.assign(document.createElement('span'), {
      className: 'crosshair__line crosshair__line--bottom',
    }),
    Object.assign(document.createElement('span'), {
      className: 'crosshair__line crosshair__line--left',
    }),
  );
  return visual;
}

export interface CrosshairEditor {
  open(): void;
  close(): void;
  dispose(): void;
}

export function createCrosshairEditor(root: ParentNode): CrosshairEditor {
  const button = requireElement<HTMLButtonElement>(root, 'crosshair-button');
  const selectedLabel = requireElement<HTMLSpanElement>(root, 'crosshair-selected');
  const overlay = requireElement<HTMLDivElement>(root, 'crosshair-overlay');
  const closeButton = requireElement<HTMLButtonElement>(root, 'crosshair-close');
  const saveButton = requireElement<HTMLButtonElement>(root, 'crosshair-save');
  const resetButton = requireElement<HTMLButtonElement>(root, 'crosshair-reset');
  const list = requireElement<HTMLDivElement>(root, 'crosshair-list');
  const count = requireElement<HTMLSpanElement>(root, 'crosshair-count');
  const errorText = requireElement<HTMLParagraphElement>(root, 'crosshair-error');
  const statusText = requireElement<HTMLSpanElement>(root, 'crosshair-status');
  const preview = requireElement<HTMLDivElement>(root, 'crosshair-preview');
  const gameCrosshair = requireElement<HTMLDivElement>(root, 'crosshair');
  const nameInput = requireElement<HTMLInputElement>(root, 'crosshair-name');
  const styleInput = requireElement<HTMLSelectElement>(root, 'crosshair-style');
  const colorInput = requireElement<HTMLInputElement>(root, 'crosshair-color');
  const lengthInput = requireElement<HTMLInputElement>(root, 'crosshair-length');
  const thicknessInput = requireElement<HTMLInputElement>(root, 'crosshair-thickness');
  const gapInput = requireElement<HTMLInputElement>(root, 'crosshair-gap');
  const dotSizeInput = requireElement<HTMLInputElement>(root, 'crosshair-dot-size');
  const opacityInput = requireElement<HTMLInputElement>(root, 'crosshair-opacity');
  const lengthValue = requireElement<HTMLOutputElement>(root, 'crosshair-length-value');
  const thicknessValue = requireElement<HTMLOutputElement>(root, 'crosshair-thickness-value');
  const gapValue = requireElement<HTMLOutputElement>(root, 'crosshair-gap-value');
  const dotSizeValue = requireElement<HTMLOutputElement>(root, 'crosshair-dot-size-value');
  const opacityValue = requireElement<HTMLOutputElement>(root, 'crosshair-opacity-value');
  const playerName = root.querySelector<HTMLInputElement>('#name-input');

  let current = loadCrosshairPreset();
  let catalog: CrosshairPreset[] = [DEFAULT_CROSSHAIR];
  let saveInFlight = false;
  let deletingId: string | null = null;

  for (const style of CROSSHAIR_STYLES) {
    const option = document.createElement('option');
    option.value = style;
    option.textContent = STYLE_LABEL[style];
    styleInput.append(option);
  }

  const apply = (preset: CrosshairPreset, remember = true): void => {
    current = preset;
    applyVisualStyles(gameCrosshair, preset);
    setText(selectedLabel, preset.name);
    if (remember) {
      saveCrosshairPreset(preset);
    }
  };

  const applyPreview = (preset: CrosshairPreset): void => {
    applyVisualStyles(preview, preset);
  };

  const syncControls = (preset: CrosshairPreset): void => {
    nameInput.value = preset.name;
    styleInput.value = preset.style;
    colorInput.value = preset.color;
    lengthInput.value = String(preset.length);
    thicknessInput.value = String(preset.thickness);
    gapInput.value = String(preset.gap);
    dotSizeInput.value = String(preset.dotSize);
    opacityInput.value = String(preset.opacity);
    updateOutputs();
    applyPreview(preset);
  };

  const updateOutputs = (): void => {
    setText(lengthValue, `${lengthInput.value} px`);
    setText(thicknessValue, `${thicknessInput.value} px`);
    setText(gapValue, `${gapInput.value} px`);
    setText(dotSizeValue, `${dotSizeInput.value} px`);
    setText(opacityValue, `${Math.round(Number(opacityInput.value) * 100)}%`);
  };

  const readDraft = () => {
    const draft = sanitizeCrosshairDraft({
      name: nameInput.value,
      style: styleInput.value,
      color: colorInput.value,
      length: Number(lengthInput.value),
      thickness: Number(thicknessInput.value),
      gap: Number(gapInput.value),
      dotSize: Number(dotSizeInput.value),
      opacity: Number(opacityInput.value),
    });
    if (draft === null) {
      setText(errorText, 'Проверьте название и цвет прицела');
      return null;
    }
    setText(errorText, '');
    return draft;
  };

  const updatePreviewFromControls = (): void => {
    updateOutputs();
    const draft = readDraft();
    if (draft !== null) {
      applyPreview({ ...draft, id: 'preview', author: 'Вы' });
    }
  };

  const renderCatalog = (): void => {
    list.replaceChildren();
    setText(count, `${catalog.length} ${catalog.length === 1 ? 'ВАРИАНТ' : 'ВАРИАНТОВ'}`);
    for (const preset of catalog) {
      const row = document.createElement('div');
      row.className = 'crosshair-list__row';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'crosshair-list__item';
      item.classList.toggle('is-active', preset.id === current.id);
      const previewFrame = document.createElement('span');
      previewFrame.className = 'crosshair-list__preview';
      previewFrame.append(createVisual(preset, 0.55));
      item.append(previewFrame);
      const copy = document.createElement('span');
      copy.className = 'crosshair-list__copy';
      const title = document.createElement('strong');
      title.textContent = preset.name;
      const author = document.createElement('small');
      author.textContent = preset.author;
      copy.append(title, author);
      item.append(copy);
      item.addEventListener('click', () => {
        apply(preset);
        syncControls(preset);
        setText(errorText, '');
        setText(statusText, `Выбран прицел «${preset.name}»`);
        renderCatalog();
      });
      row.append(item);

      if (preset.id !== DEFAULT_CROSSHAIR.id) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'crosshair-list__delete';
        remove.textContent = '×';
        remove.title = `Удалить прицел «${preset.name}»`;
        remove.setAttribute('aria-label', `Удалить прицел «${preset.name}»`);
        remove.disabled = deletingId !== null;
        remove.addEventListener('click', () => {
          void deletePreset(preset);
        });
        row.append(remove);
      }

      list.append(row);
    }
  };

  const loadCatalog = async (
    message = 'Выберите готовый прицел или создайте свой',
  ): Promise<void> => {
    setText(statusText, 'Загружаем каталог...');
    try {
      const response = await fetch('/api/crosshairs', { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error('Сервер не вернул каталог');
      }
      const raw: unknown = await response.json();
      const parsed = Array.isArray(raw)
        ? raw
            .map((entry) => sanitizeStoredCrosshair(entry))
            .filter((entry): entry is CrosshairPreset => entry !== null)
        : [];
      catalog = parsed.length > 0 ? parsed : [DEFAULT_CROSSHAIR];
      renderCatalog();
      setText(statusText, message);
    } catch {
      catalog = [DEFAULT_CROSSHAIR];
      renderCatalog();
      setText(statusText, 'Каталог сервера недоступен — можно использовать точку');
    }
  };

  async function deletePreset(preset: CrosshairPreset): Promise<void> {
    if (preset.id === DEFAULT_CROSSHAIR.id || deletingId !== null) {
      return;
    }
    if (!window.confirm(`Удалить прицел «${preset.name}» из общего каталога?`)) {
      return;
    }

    deletingId = preset.id;
    setText(errorText, '');
    setText(statusText, `Удаляем прицел «${preset.name}»...`);
    renderCatalog();
    try {
      const response = await fetch(`/api/crosshairs/${encodeURIComponent(preset.id)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const raw: unknown = await response.json().catch(() => null);
        const message =
          typeof raw === 'object' && raw !== null && 'error' in raw
            ? String((raw as { error?: unknown }).error)
            : 'Не удалось удалить прицел';
        throw new Error(message);
      }

      if (current.id === preset.id) {
        apply(DEFAULT_CROSSHAIR);
        syncControls(DEFAULT_CROSSHAIR);
      }
      await loadCatalog(`Прицел «${preset.name}» удалён`);
    } catch (error) {
      setText(errorText, error instanceof Error ? error.message : 'Не удалось удалить прицел');
    } finally {
      deletingId = null;
      renderCatalog();
    }
  }

  const open = (): void => {
    overlay.classList.add('is-visible');
    setText(errorText, '');
    setText(statusText, '');
    syncControls(current);
    void loadCatalog();
  };

  const close = (): void => {
    overlay.classList.remove('is-visible');
    const draft = readDraft();
    if (draft !== null) {
      apply({ ...draft, id: current.id, author: current.author });
    } else {
      apply(current, false);
    }
    syncControls(current);
    setText(errorText, '');
  };

  const save = async (): Promise<void> => {
    if (saveInFlight) {
      return;
    }
    const draft = readDraft();
    if (draft === null) {
      return;
    }
    saveInFlight = true;
    saveButton.disabled = true;
    setText(saveButton, 'СОХРАНЕНИЕ...');
    setText(errorText, '');
    try {
      const response = await fetch('/api/crosshairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...draft,
          author: playerName?.value.trim() || 'Аноним',
        }),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof raw === 'object' && raw !== null && 'error' in raw
            ? String((raw as { error?: unknown }).error)
            : 'Не удалось сохранить прицел';
        throw new Error(message);
      }
      const saved = sanitizeStoredCrosshair(raw);
      if (saved === null) {
        throw new Error('Сервер вернул некорректный прицел');
      }
      apply(saved);
      syncControls(saved);
      await loadCatalog(`Прицел «${saved.name}» сохранён на сервере`);
    } catch (error) {
      setText(errorText, error instanceof Error ? error.message : 'Не удалось сохранить прицел');
    } finally {
      saveInFlight = false;
      saveButton.disabled = false;
      setText(saveButton, 'СОХРАНИТЬ НА СЕРВЕРЕ');
    }
  };

  button.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  saveButton.addEventListener('click', () => {
    void save();
  });
  resetButton.addEventListener('click', () => {
    apply(DEFAULT_CROSSHAIR);
    syncControls(DEFAULT_CROSSHAIR);
    renderCatalog();
    setText(errorText, '');
    setText(statusText, 'Вернули классическую точку');
  });
  for (const input of [
    nameInput,
    styleInput,
    colorInput,
    lengthInput,
    thicknessInput,
    gapInput,
    dotSizeInput,
    opacityInput,
  ]) {
    input.addEventListener('input', updatePreviewFromControls);
    input.addEventListener('change', updatePreviewFromControls);
  }

  apply(current, false);
  syncControls(current);

  return {
    open,
    close,
    dispose: () => {
      overlay.classList.remove('is-visible');
    },
  };
}
