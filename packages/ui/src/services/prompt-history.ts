export interface PromptHistoryNavigation {
  cursor: number;
  savedDraft: string;
}

export interface PromptHistoryStep {
  text: string;
  navigation: PromptHistoryNavigation | null;
}

function entries(history: readonly string[]): string[] {
  return history.filter((text) => text.trim().length > 0);
}

export function previousPrompt(
  history: readonly string[],
  navigation: PromptHistoryNavigation | null,
  currentDraft: string,
): PromptHistoryStep | null {
  const items = entries(history);
  if (items.length === 0) return null;

  const current = navigation && navigation.cursor >= 0 && navigation.cursor < items.length
    ? navigation.cursor
    : items.length;
  const cursor = current <= 0 ? items.length - 1 : current - 1;

  return {
    text: items[cursor],
    navigation: {
      cursor,
      savedDraft: navigation?.savedDraft ?? currentDraft,
    },
  };
}

export function nextPrompt(
  history: readonly string[],
  navigation: PromptHistoryNavigation | null,
): PromptHistoryStep | null {
  if (!navigation) return null;

  const items = entries(history);
  if (items.length === 0) return { text: navigation.savedDraft, navigation: null };

  const current = navigation.cursor >= 0 && navigation.cursor < items.length
    ? navigation.cursor
    : items.length - 1;
  if (current >= items.length - 1) {
    return { text: navigation.savedDraft, navigation: null };
  }

  const cursor = current + 1;
  return {
    text: items[cursor],
    navigation: { ...navigation, cursor },
  };
}
