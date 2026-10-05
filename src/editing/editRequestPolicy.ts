export interface EditRequestPolicy {
  reviewOnly: boolean;
  creationOnly: boolean;
  onlyPath?: string;
  conversationId?: string;
  turnId?: string;
}

export class EditRequestError extends Error {
  readonly requiresUserAction = true;
}

export function getEditRequestPolicy(prompt: string): EditRequestPolicy {
  const reviewOnly = /\b(?:show|prepare|propose|preview)\b[^\n]{0,140}\b(?:approval|approve|review)\b|\b(?:do not|don't|never)\s+(?:apply|save|write)\b[^\n]{0,100}\b(?:approval|approve|review)\b/i.test(prompt);
  const creationOnly = /\bif\b[^\n.]{0,90}\b(?:already\s+)?exists\b[^\n.]{0,90}\b(?:stop|do not|don't|tell me)\b|\b(?:do not|don't|never)\s+overwrite\b/i.test(prompt);
  const namedFile = prompt.match(/\b(?:create|add|make)\s+(?:a\s+)?(?:new\s+)?file\s+(?:named|called)\s+[`"']?([^\s`"']+)/i)?.[1];
  const restricted = /\b(?:do not|don't)\s+(?:modify|change|edit|touch)\s+any\s+other\s+files?\b/i.test(prompt);
  return { reviewOnly, creationOnly, onlyPath: restricted ? namedFile : undefined };
}
