/**
 * Section Injector
 *
 * Adds new sections to resume HTML with minimal logic. Does not clone or modify
 * existing template structure—only creates new elements and appends them.
 * Works across templates without disrupting styles.
 */

import {
  ResumeData,
  SectionType,
  ProjectItem,
  LanguageItem,
  CertificationItem,
  TrainingItem,
  VolunteeringItem,
} from './schema';
import { ResumeTemplate } from '../templates/types';
import { parseHtmlToDOM, serializeDOMToHtml, extractText } from './utils';

const SECTION_TITLES: Record<SectionType, string> = {
  profile: 'Contact',
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  languages: 'Languages',
  certifications: 'Certifications',
  training: 'Training & Courses',
  volunteering: 'Volunteering',
  awards: 'Awards',
  publications: 'Publications',
  custom: 'Additional Information',
};

const SECTION_KEYWORDS: Record<SectionType, string[]> = {
  profile: ['contact', 'profile'],
  summary: ['summary', 'about', 'objective'],
  experience: ['experience', 'work', 'employment'],
  education: ['education', 'academic'],
  skills: ['skill', 'expertise'],
  projects: ['project', 'portfolio'],
  languages: ['language'],
  certifications: ['certification', 'certificate', 'license'],
  training: ['training', 'course'],
  volunteering: ['volunteering', 'volunteer', 'community'],
  awards: ['award', 'honor', 'achievement'],
  publications: ['publication'],
  custom: ['custom'],
};

/** Canonical order for all section types; used to insert new sections in the right place. */
const DEFAULT_SECTION_ORDER: SectionType[] = [
  'profile', 'summary', 'experience', 'education', 'skills',
  'projects', 'languages', 'certifications', 'training', 'volunteering', 'awards', 'publications', 'custom',
];

/** Section types that belong in the main content column (with experience/education), not the sidebar. */
const MAIN_CONTENT_SECTION_TYPES: SectionType[] = [
  'summary', 'experience', 'education', 'projects', 'training', 'volunteering', 'awards', 'publications',
];

export function injectSection(
  html: string,
  sectionType: SectionType,
  data: ResumeData,
  template: ResumeTemplate
): { html: string; sectionId: string } {
  const doc = parseHtmlToDOM(html);
  const section = buildSection(doc, sectionType, data);
  if (!section) return { html, sectionId: '' };

  const sectionId = `section-${sectionType}-${Date.now()}`;
  section.id = sectionId;

  const { parent, insertAfter } = findInsertionPoint(doc, sectionType, template);
  if (insertAfter) {
    const next = insertAfter.nextSibling;
    parent.insertBefore(section, next);
  } else {
    parent.appendChild(section);
  }

  return { html: serializeDOMToHtml(doc), sectionId };
}

/**
 * Find the container that holds "main" resume content (experience, education). Used so that
 * training/volunteering/awards etc. are added to the visible main column, not the sidebar.
 */
function findMainContentContainer(doc: Document): Element | null {
  const sectionElements = doc.querySelectorAll('.section, section, [class*="section"]');
  for (const el of Array.from(sectionElements)) {
    const titleEl = el.querySelector('.section-title, h2, h3');
    if (!titleEl) continue;
    const type = getSectionTypeFromTitle(extractText(titleEl));
    if (type === 'experience' || type === 'education') {
      const parent = el.parentElement;
      if (parent) return parent;
    }
  }
  // Fallback: common main content wrappers in templates
  return doc.querySelector('.right-content, .right-column .content, [class*="right"] [class*="content"]') as Element | null;
}

/**
 * Find where to insert: the parent and the element to insert after (so new section goes in correct order).
 * Uses template sectionOrder or DEFAULT_SECTION_ORDER to place the new section after the right existing section.
 * For training, volunteering, awards, publications: prefers inserting into the main content column (with experience/education)
 * so they appear in a visible location instead of the sidebar.
 */
function findInsertionPoint(
  doc: Document,
  sectionType: SectionType,
  _template: ResumeTemplate
): { parent: Element; insertAfter: Element | null } {
  const order = DEFAULT_SECTION_ORDER;
  const myIndex = order.indexOf(sectionType);
  const effectiveIndex = myIndex >= 0 ? myIndex : order.length;

  const sectionElements = doc.querySelectorAll('.section, section, [class*="section"]');
  if (sectionElements.length === 0) {
    const parent = doc.querySelector('.main-content, .right-column, .left-column, .content') || doc.body;
    return { parent: parent as Element, insertAfter: null };
  }

  // For main-content section types (training, volunteering, awards, etc.), prefer the main content column
  // so the new section appears with experience/education instead of in the sidebar.
  if (MAIN_CONTENT_SECTION_TYPES.includes(sectionType)) {
    const mainContainer = findMainContentContainer(doc);
    if (mainContainer) {
      const sectionsInMain = Array.from(mainContainer.querySelectorAll('.section, section, [class*="section"]'));
      let bestInMain: Element | null = null;
      let bestIndexInMain = -1;
      for (const el of sectionsInMain) {
        const titleEl = el.querySelector('.section-title, h2, h3');
        if (!titleEl) continue;
        const type = getSectionTypeFromTitle(extractText(titleEl));
        if (type === null) continue;
        const idx = order.indexOf(type);
        const orderIndex = idx >= 0 ? idx : order.length;
        if (orderIndex < effectiveIndex && orderIndex > bestIndexInMain) {
          bestInMain = el;
          bestIndexInMain = orderIndex;
        }
      }
      if (bestInMain) {
        return { parent: mainContainer, insertAfter: bestInMain };
      }
      // No preceding section in main container — append at end
      const lastInMain = sectionsInMain[sectionsInMain.length - 1];
      if (lastInMain) {
        return { parent: mainContainer, insertAfter: lastInMain };
      }
      return { parent: mainContainer, insertAfter: null };
    }
  }

  let best: Element | null = null;
  let bestIndex = -1;

  for (const el of Array.from(sectionElements)) {
    const titleEl = el.querySelector('.section-title, h2, h3');
    if (!titleEl) continue;
    const type = getSectionTypeFromTitle(extractText(titleEl));
    if (type === null) continue;
    const idx = order.indexOf(type);
    const orderIndex = idx >= 0 ? idx : order.length;
    if (orderIndex < effectiveIndex && orderIndex > bestIndex) {
      best = el;
      bestIndex = orderIndex;
    }
  }

  if (best) {
    const parent = best.parentElement;
    if (parent) return { parent, insertAfter: best };
  }

  const last = sectionElements[sectionElements.length - 1];
  const parent = last.parentElement || doc.body;
  return { parent: parent as Element, insertAfter: last };
}

function getSectionTypeFromTitle(titleText: string): SectionType | null {
  const lower = titleText.toLowerCase();
  const map: Array<{ type: SectionType; keywords: string[] }> = [
    { type: 'profile', keywords: ['contact', 'profile'] },
    { type: 'summary', keywords: ['summary', 'about', 'objective', 'professional summary'] },
    { type: 'experience', keywords: ['experience', 'work', 'employment', 'professional'] },
    { type: 'education', keywords: ['education', 'academic'] },
    { type: 'skills', keywords: ['skill', 'expertise'] },
    { type: 'projects', keywords: ['project', 'portfolio'] },
    { type: 'languages', keywords: ['language'] },
    { type: 'certifications', keywords: ['certification', 'certificate', 'license', 'membership'] },
    { type: 'training', keywords: ['training', 'course'] },
    { type: 'volunteering', keywords: ['volunteering', 'volunteer', 'community'] },
    { type: 'awards', keywords: ['award', 'honor', 'achievement'] },
    { type: 'publications', keywords: ['publication'] },
  ];
  for (const { type, keywords } of map) {
    if (keywords.some(kw => lower.includes(kw))) return type;
  }
  return null;
}

/**
 * Build a new section from scratch. No cloning—only create elements.
 * Uses common class names (section, section-title, experience-item, etc.) so
 * most templates already style them.
 */
function buildSection(doc: Document, sectionType: SectionType, data: ResumeData): Element | null {
  const section = doc.createElement('div');
  section.className = 'section';

  const title = doc.createElement('h2');
  title.className = 'section-title';
  title.textContent = SECTION_TITLES[sectionType] ?? sectionType;
  section.appendChild(title);

  const content = doc.createElement('div');
  content.className = 'section-content';

  switch (sectionType) {
    case 'projects':
      appendProjectItems(content, data.projects, doc);
      break;
    case 'languages':
      appendListItems(content, data.languages?.map(l => `${l.language} (${l.proficiency || 'Proficient'})`) ?? [''], doc);
      break;
    case 'certifications':
      appendListItems(content, data.certifications?.map(c => [c.name, c.issuer, c.date].filter(Boolean).join(' – ')) ?? [''], doc);
      break;
    case 'training':
      appendListItems(content, data.training?.map(t => `${t.name}${t.provider ? ` – ${t.provider}` : ''}`) ?? [''], doc);
      break;
    case 'volunteering':
      appendVolunteerItems(content, data.volunteering, doc);
      break;
    case 'awards':
      appendListItems(content, data.awards?.map(a => [a.name, a.issuer, a.date].filter(Boolean).join(' – ')) ?? [''], doc);
      break;
    case 'publications':
      appendListItems(content, data.publications?.map(p => [p.title, p.publisher, p.date].filter(Boolean).join(' – ')) ?? [''], doc);
      break;
    case 'custom':
      appendOneBlock(content, '', '', doc);
      break;
    default:
      appendListItems(content, [''], doc);
  }

  section.appendChild(content);
  return section;
}

function appendListItems(container: Element, texts: string[], doc: Document): void {
  const ul = doc.createElement('ul');
  ul.className = 'skills-list';
  for (const text of texts) {
    const li = doc.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

function appendOneBlock(container: Element, titleText: string, descText: string, doc: Document): void {
  const item = doc.createElement('div');
  item.className = 'experience-item';
  const title = doc.createElement('h3');
  title.className = 'title';
  title.textContent = titleText;
  item.appendChild(title);
  if (descText) {
    const desc = doc.createElement('p');
    desc.className = 'description';
    desc.textContent = descText;
    item.appendChild(desc);
  }
  container.appendChild(item);
}

function appendProjectItems(container: Element, projects: ProjectItem[] | undefined, doc: Document): void {
  const list = projects && projects.length > 0 ? projects : [{ id: '', title: '', description: '', organization: undefined, startDate: undefined, endDate: undefined, url: undefined }];
  for (const p of list) {
    const item = doc.createElement('div');
    item.className = 'experience-item project-item';
    const title = doc.createElement('h3');
    title.className = 'title';
    if (p.url) {
      const a = doc.createElement('a');
      a.href = p.url;
      a.target = '_blank';
      a.textContent = p.title || '';
      title.appendChild(a);
    } else {
      title.textContent = p.title || '';
    }
    item.appendChild(title);
    if (p.organization) {
      const org = doc.createElement('div');
      org.className = 'company';
      org.textContent = p.organization;
      item.appendChild(org);
    }
    const desc = doc.createElement('p');
    desc.className = 'description';
    desc.textContent = p.description || '';
    item.appendChild(desc);
    container.appendChild(item);
  }
}

function appendVolunteerItems(container: Element, volunteering: VolunteeringItem[] | undefined, doc: Document): void {
  const list = volunteering && volunteering.length > 0 ? volunteering : [{ id: '', role: '', organization: '', startDate: '', endDate: '', description: '' }];
  for (const v of list) {
    const item = doc.createElement('div');
    item.className = 'experience-item volunteer-item';
    const title = doc.createElement('h3');
    title.className = 'title';
    title.textContent = v.role || '';
    item.appendChild(title);
    const org = doc.createElement('div');
    org.className = 'company';
    org.textContent = v.organization || '';
    item.appendChild(org);
    if (v.description) {
      const desc = doc.createElement('p');
      desc.className = 'description';
      desc.textContent = v.description;
      item.appendChild(desc);
    }
    container.appendChild(item);
  }
}

function findSectionByType(doc: Document, sectionType: SectionType): Element | null {
  const keywords = SECTION_KEYWORDS[sectionType] ?? [];
  const sections = doc.querySelectorAll('.section, section, [class*="section"]');
  for (const section of Array.from(sections)) {
    const titleEl = section.querySelector('.section-title, h2, h3');
    if (titleEl) {
      const text = extractText(titleEl).toLowerCase();
      if (keywords.some(kw => text.includes(kw))) return section;
    }
  }
  return null;
}

export function hasSectionInHtml(html: string, sectionType: SectionType): boolean {
  const doc = parseHtmlToDOM(html);
  return findSectionByType(doc, sectionType) !== null;
}

export function getMissingSections(
  html: string,
  data: ResumeData,
  template: ResumeTemplate
): SectionType[] {
  const supported = template.supportedSections ?? ['profile', 'summary', 'experience', 'education', 'skills'];
  const missing: SectionType[] = [];
  for (const sectionType of supported) {
    if (!hasSectionData(data, sectionType)) continue;
    if (!hasSectionInHtml(html, sectionType)) missing.push(sectionType);
  }
  return missing;
}

function hasSectionData(data: ResumeData, sectionType: SectionType): boolean {
  switch (sectionType) {
    case 'profile': {
      const profile = data.profile;
      return !!(
        profile &&
        (profile.phone || profile.email || profile.location || profile.website || profile.linkedin || profile.github) &&
        [profile.phone, profile.email, profile.location, profile.website, profile.linkedin, profile.github]
          .some(value => value != null && String(value).trim() !== '' && String(value).toLowerCase() !== 'undefined')
      );
    }
    case 'summary': return !!data.summary?.text;
    case 'experience': return !!(data.experience?.length);
    case 'education': return !!(data.education?.length);
    case 'skills': return !!(data.skills && (data.skills.groups?.length || data.skills.items?.length));
    case 'projects': return !!(data.projects?.length);
    case 'languages': return !!(data.languages?.length);
    case 'certifications': return !!(data.certifications?.length);
    case 'training': return !!(data.training?.length);
    case 'volunteering': return !!(data.volunteering?.length);
    case 'awards': return !!(data.awards?.length);
    case 'publications': return !!(data.publications?.length);
    default: return false;
  }
}
