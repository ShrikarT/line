import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');

export const ORGANIZATION_SERVICES = [
  { id: 'text-metrics', merchant: 'A', name: 'Document metrics', price: '25000', description: 'Word, sentence and paragraph counts, with recurring terms from your actual text.' },
  { id: 'content-integrity', merchant: 'B', name: 'Content fingerprint', price: '20000', description: 'SHA-256 content fingerprint, exact UTF-8 byte length and Unicode code-point count.' },
  { id: 'line-doc-extract-v1', merchant: 'A', name: 'Document extraction', price: '50000', description: 'Extracts verbatim heading, paragraph, and list passages relevant to a bounded objective from a Markdown or plain-text document.' },
];

const STOP_WORDS = new Set([
  // Question words
  'what', 'whatever', 'which', 'whichever', 'who', 'whoever', 'whom', 'whomever', 'whose',
  'why', 'where', 'wherever', 'when', 'whenever', 'how',
  // Instruction / task / query verbs & nouns
  'extract', 'extracts', 'extraction', 'extracting', 'extracted',
  'find', 'finds', 'finding', 'found',
  'locate', 'locates', 'locating', 'located',
  'get', 'gets', 'getting', 'got',
  'show', 'shows', 'showing', 'showed', 'shown',
  'tell', 'tells', 'telling', 'told',
  'list', 'lists', 'listing', 'listed',
  'describe', 'describes', 'describing', 'described',
  'explain', 'explains', 'explaining', 'explained',
  'summarize', 'summarizes', 'summarizing', 'summarized',
  'identify', 'identifies', 'identifying', 'identified',
  'search', 'searches', 'searching', 'searched',
  'retrieve', 'retrieves', 'retrieving', 'retrieved',
  'provide', 'provides', 'providing', 'provided',
  'say', 'says', 'saying', 'said',
  'state', 'states', 'stating', 'stated',
  'mention', 'mentions', 'mentioning', 'mentioned',
  'give', 'gives', 'giving', 'gave', 'given',
  'check', 'checks', 'checking', 'checked',
  'specify', 'specifies', 'specifying', 'specified',
  'detail', 'details', 'detailing', 'detailed',
  'read', 'reads', 'reading',
  // Document / structure meta words
  'document', 'documents', 'text', 'texts', 'file', 'files', 'content', 'contents',
  'passage', 'passages', 'section', 'sections', 'paragraph', 'paragraphs',
  'page', 'pages', 'article', 'articles', 'heading', 'headings', 'title', 'titles',
  // Articles, demonstratives, pronouns
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  // Prepositions & conjunctions
  'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'because', 'as', 'until', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
  'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  // Quantifiers, adverbs, miscellaneous function words
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'now', 'also',
  // Auxiliary verbs / copula
  'can', 'cannot', 'cant', 'could', 'couldnt', 'will', 'wont', 'would', 'wouldnt',
  'shall', 'should', 'shouldnt', 'may', 'might', 'must', 'mustnt',
  'is', 'isn', 'isnt', 'am', 'are', 'arent', 'was', 'wasnt', 'were', 'werent',
  'be', 'been', 'being',
  'have', 'has', 'hasnt', 'had', 'hadnt', 'having',
  'do', 'does', 'doesnt', 'did', 'didnt', 'doing', 'done'
]);

function tokenize(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function parseDocumentPassages(document) {
  const passages = [];
  const headingStack = [];

  let currentOffset = 0;
  const lines = [];
  const lineRegex = /([^\r\n]*)(?:\r?\n|$)/gy;
  while (currentOffset < document.length) {
    lineRegex.lastIndex = currentOffset;
    const match = lineRegex.exec(document);
    if (!match) break;
    const lineText = match[1];
    const matchLength = match[0].length;
    if (matchLength === 0) break;
    lines.push({
      text: lineText,
      start: currentOffset,
      end: currentOffset + lineText.length,
      fullEnd: currentOffset + matchLength
    });
    currentOffset += matchLength;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.text.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    const headingMatch = line.text.match(/^(\s*)(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[2].length;
      const title = headingMatch[3].trim();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      let hStart = line.start;
      let hEnd = line.end;
      while (hEnd > hStart && /[\s\r\n]/.test(document[hEnd - 1])) {
        hEnd--;
      }
      if (hEnd > hStart) {
        passages.push({
          headingPath: headingStack.slice(0, -1).map(h => h.title),
          text: document.slice(hStart, hEnd),
          start: hStart,
          end: hEnd,
          type: 'heading',
          title
        });
      }
      i++;
      continue;
    }

    const listMatch = line.text.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      let listStart = line.start;
      let listEnd = line.end;
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (nextLine.text.trim() === '' || nextLine.text.match(/^(\s*)(?:#{1,6}\s+|[-*+]|\d+\.)/)) break;
        if (/^\s{2,}/.test(nextLine.text)) {
          listEnd = nextLine.end;
          j++;
        } else {
          break;
        }
      }
      while (listEnd > listStart && /[\s\r\n]/.test(document[listEnd - 1])) {
        listEnd--;
      }
      if (listEnd > listStart) {
        passages.push({
          headingPath: headingStack.map(h => h.title),
          text: document.slice(listStart, listEnd),
          start: listStart,
          end: listEnd,
          type: 'list_item'
        });
      }
      i = j;
      continue;
    }

    let pStart = line.start;
    let pEnd = line.end;
    let j = i + 1;
    while (j < lines.length) {
      const nextLine = lines[j];
      const nextTrimmed = nextLine.text.trim();
      if (!nextTrimmed) break;
      if (nextLine.text.match(/^(\s*)(?:#{1,6}\s+|[-*+]|\d+\.)/)) break;
      pEnd = nextLine.end;
      j++;
    }
    while (pEnd > pStart && /[\s\r\n]/.test(document[pEnd - 1])) {
      pEnd--;
    }
    if (pEnd > pStart) {
      passages.push({
        headingPath: headingStack.map(h => h.title),
        text: document.slice(pStart, pEnd),
        start: pStart,
        end: pEnd,
        type: 'paragraph'
      });
    }
    i = j;
  }

  return passages;
}

function scorePassage(passage, objectiveTerms) {
  let score = 0;
  const passageTokens = tokenize(passage.text);
  const passageCounts = countTokens(passageTokens);
  const headingTokens = passage.headingPath.flatMap(h => tokenize(h));
  const headingCounts = countTokens(headingTokens);

  let matchedTermsInPassage = 0;
  let matchedTermsInHeading = 0;

  for (const term of objectiveTerms) {
    const pCount = passageCounts.get(term) ?? 0;
    const hCount = headingCounts.get(term) ?? 0;

    if (pCount > 0) {
      score += pCount * 10;
      matchedTermsInPassage++;
    }
    if (hCount > 0) {
      score += hCount * 5;
      matchedTermsInHeading++;
    }
  }

  if (matchedTermsInPassage > 1) {
    score += matchedTermsInPassage * 5;
  }
  if (matchedTermsInHeading > 1) {
    score += matchedTermsInHeading * 3;
  }

  return score;
}

export function extractDocumentSpans(document, objective) {
  if (typeof document !== 'string' || !document.trim() || [...document].length > 5000) {
    throw Error('Supply a document of up to 5000 characters.');
  }
  if (typeof objective !== 'string' || !objective.trim() || [...objective].length > 500) {
    throw Error('Supply an extraction objective of up to 500 characters.');
  }

  const passages = parseDocumentPassages(document);
  const rawTerms = tokenize(objective);
  const filteredTerms = [...new Set(rawTerms.filter(t => !STOP_WORDS.has(t) && t.length > 0))];

  const scored = [];
  if (filteredTerms.length > 0) {
    for (const passage of passages) {
      const score = scorePassage(passage, filteredTerms);
      if (score > 0) {
        scored.push({ passage, score });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || a.passage.start - b.passage.start);

  let matched = scored.slice(0, 30).map(s => ({
    headingPath: s.passage.headingPath,
    text: s.passage.text,
    start: s.passage.start,
    end: s.passage.end
  }));

  const buildOutput = passagesList => ({
    service: 'line-doc-extract-v1',
    version: 1,
    inputDigest: digest(document),
    objectiveDigest: digest(objective),
    objective: objective.trim(),
    passages: passagesList,
    outcome: passagesList.length > 0 ? 'evidence_found' : 'no_matching_evidence',
    noMatchingEvidence: passagesList.length === 0
  });

  while (matched.length > 0 && Buffer.byteLength(JSON.stringify(buildOutput(matched)), 'utf8') > 32768) {
    matched.pop();
  }

  const result = buildOutput(matched);

  for (const p of result.passages) {
    if (document.slice(p.start, p.end) !== p.text) {
      throw Error('Internal error: verbatim passage offset invariant failed.');
    }
  }

  return result;
}

export function fulfillOrganizationService(id, document, objective = '') {
  if (id === 'line-doc-extract-v1') {
    return extractDocumentSpans(document, objective);
  }
  if (typeof document !== 'string' || !document.trim() || document.length > 5000) {
    throw Error('Supply a document of up to 5000 characters.');
  }
  if (id === 'text-metrics') {
    const words = document.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [], counts = new Map();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    return {
      words: words.length,
      sentences: (document.match(/[^.!?]+[.!?]?/g) ?? []).filter(value => value.trim()).length,
      paragraphs: document.trim().split(/\n\s*\n/).length,
      recurringTerms: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([term, count]) => ({ term, count }))
    };
  }
  if (id === 'content-integrity') {
    return {
      algorithm: 'SHA-256',
      sha256: digest(document),
      utf8Bytes: Buffer.byteLength(document, 'utf8'),
      unicodeCodePoints: [...document].length
    };
  }
  throw Error('Unknown merchant service.');
}
