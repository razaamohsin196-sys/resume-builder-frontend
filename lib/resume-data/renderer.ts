/**
 * Template Renderer
 * 
 * Renders structured resume data to HTML templates.
 * Uses DOM manipulation to populate template skeletons with actual data.
 */

import {
  ResumeData,
  ExperienceItem,
  EducationItem,
  ProjectItem,
  LanguageItem,
  CertificationItem,
  TrainingItem,
  VolunteeringItem,
  AwardItem,
  PublicationItem,
  ReferenceItem,
} from './schema';
import { ResumeTemplate } from '../templates/types';
import {
  parseHtmlToDOM,
  serializeDOMToHtml,
  extractText,
  cloneElement,
} from './utils';
import { isPlaceholderText } from './placeholder-filter';
import { deduplicateArray, deduplicateElementText, deduplicateHtml, removeEmptyBulletListsFromDocument } from './deduplication';

/** True only when the value is real user data (not undefined, empty, or placeholder). */
function hasRealValue(value: string | undefined): boolean {
  if (value == null || value === '' || String(value).toLowerCase() === 'undefined') return false;
  const t = String(value).trim();
  return t.length > 0 && !isPlaceholderText(t);
}

/**
 * Main renderer function: ResumeData + Template → HTML
 */
export function renderToTemplate(data: ResumeData, template: ResumeTemplate): string {
  const doc = parseHtmlToDOM(template.html);

  // Render each section
  renderProfile(doc, data);
  renderSummary(doc, data);
  renderExperience(doc, data);
  renderEducation(doc, data);
  renderSkills(doc, data);
  renderProjects(doc, data);
  renderLanguages(doc, data);
  renderCertifications(doc, data);
  renderTraining(doc, data);
  renderVolunteering(doc, data);
  renderAwards(doc, data);
  renderPublications(doc, data);
  renderReferences(doc, data);

  // Remove sections that have no user data (avoids blank placeholder sections)
  removeEmptySections(doc, data);
  
  // Strip any remaining placeholder / Lorem ipsum content
  stripRemainingPlaceholders(doc, data);
  
  // Fix CSS for continuous content flow (no blank pages or clipping)
  fixContinuousLayoutCSS(doc, template);
  
  // Embed ResumeData as JSON in the HTML for editor access
  embedResumeData(doc, data);
  
  let html = serializeDOMToHtml(doc);
  
  // Final string-level safety net: strip any remaining placeholder text patterns
  // that the DOM-based approach might have missed
  html = stripPlaceholderStrings(html);
  
  // Final deduplication pass to remove any remaining duplicates
  html = deduplicateHtml(html);
  
  return html;
}

/**
 * Set value on a contact item (e.g. .contact-item.contact-phone). If the element has
 * multiple children (icon + value span), set the value on the last child so the icon is preserved.
 */
function setContactItemValue(el: Element, value: string): void {
  if (el.children.length > 1 && el.lastElementChild) {
    el.lastElementChild.textContent = value;
  } else {
    el.textContent = value;
  }
}

type ContactType = 'email' | 'phone' | 'location' | 'website' | 'linkedin' | 'github';

function normalizeUrlForDisplay(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function getContactValue(profile: ResumeData['profile'], type: ContactType): string | undefined {
  switch (type) {
    case 'email': return profile.email;
    case 'phone': return profile.phone;
    case 'location': return profile.location;
    case 'website': return profile.website;
    case 'linkedin': return profile.linkedin;
    case 'github': return profile.github;
    default: return undefined;
  }
}

function isLikelyContactSection(section: Element): boolean {
  const className = section.className || '';
  if (/contact/i.test(className)) return true;
  if (section.querySelector('.contact-item')) return true;
  const titleEl = section.querySelector('.section-title, h2, h3, h4');
  return !!(titleEl && /contact/i.test(extractText(titleEl)));
}

function findContactTemplateRow(section: Element): Element | null {
  const row = section.querySelector('.contact-item');
  if (row) return row;
  const fallbackRows = section.querySelectorAll('.contact-info > div, .contact-info > span, .contact-info > p');
  for (const el of Array.from(fallbackRows)) {
    if ((el as Element).children.length >= 1) return el as Element;
  }
  return null;
}

function findContactIconElement(row: Element): Element | null {
  if (row.children.length > 1 && row.firstElementChild) {
    return row.firstElementChild;
  }
  const icon = row.querySelector('i, img, svg');
  if (icon) return icon;
  const spans = row.querySelectorAll('span');
  if (spans.length > 1) return spans[0];
  return row.firstElementChild || null;
}

function updateIconifySrc(src: string, type: ContactType): string | null {
  const match = src.match(/api\.iconify\.design\/([^/]+)\/([^.?]+)\.svg/i);
  if (!match) return null;
  const set = match[1];
  const iconMap: Record<ContactType, string> = {
    email: 'email',
    phone: 'phone',
    location: 'location',
    website: 'web',
    linkedin: 'linkedin',
    github: 'github',
  };
  const iconName = iconMap[type];
  return src.replace(/api\.iconify\.design\/[^/]+\/[^.?]+\.svg/i, `api.iconify.design/${set}/${iconName}.svg`);
}

function createContactIconElement(doc: Document, type: ContactType, styleText: string): Element | null {
  const iconifyImg = doc.querySelector('img[src*="api.iconify.design"]') as HTMLImageElement | null;
  if (iconifyImg) {
    const img = iconifyImg.cloneNode(true) as HTMLImageElement;
    const updated = updateIconifySrc(img.getAttribute('src') || '', type);
    if (updated) img.setAttribute('src', updated);
    return img;
  }

  const classMap: Record<ContactType, string | undefined> = {
    email: styleText.includes('material-symbols--alternate-email') ? 'material-symbols--alternate-email' : undefined,
    phone: styleText.includes('lets-icons--phone-light') ? 'lets-icons--phone-light' : undefined,
    location: styleText.includes('mingcute--location-2-line') ? 'mingcute--location-2-line' : undefined,
    website: undefined,
    linkedin: undefined,
    github: undefined,
  };
  const spanClass = classMap[type];
  if (spanClass) {
    const span = doc.createElement('span');
    span.className = spanClass;
    return span;
  }

  const hasFontAwesome = !!doc.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]');
  if (hasFontAwesome) {
    const iconMap: Record<ContactType, string> = {
      email: 'fa-envelope',
      phone: 'fa-phone-alt',
      location: 'fa-map-marker-alt',
      website: 'fa-globe',
      linkedin: 'fa-linkedin',
      github: 'fa-github',
    };
    const i = doc.createElement('i');
    i.className = `fas ${iconMap[type]}`;
    return i;
  }

  return null;
}

function updateContactIcon(iconEl: Element, type: ContactType, styleText: string): void {
  const tag = iconEl.tagName.toLowerCase();
  if (tag === 'i') {
    const prefix = iconEl.classList.contains('fab')
      ? 'fab'
      : iconEl.classList.contains('far')
        ? 'far'
        : iconEl.classList.contains('fas')
          ? 'fas'
          : 'fas';
    const iconMap: Record<ContactType, string> = {
      email: 'fa-envelope',
      phone: 'fa-phone-alt',
      location: 'fa-map-marker-alt',
      website: 'fa-globe',
      linkedin: 'fa-linkedin',
      github: 'fa-github',
    };
    iconEl.className = `${prefix} ${iconMap[type]}`;
    return;
  }
  if (tag === 'img') {
    const src = iconEl.getAttribute('src') || '';
    const updated = updateIconifySrc(src, type);
    if (updated) iconEl.setAttribute('src', updated);
    return;
  }
  if (tag === 'span') {
    const classMap: Record<ContactType, string | undefined> = {
      email: styleText.includes('material-symbols--alternate-email') ? 'material-symbols--alternate-email' : undefined,
      phone: styleText.includes('lets-icons--phone-light') ? 'lets-icons--phone-light' : undefined,
      location: styleText.includes('mingcute--location-2-line') ? 'mingcute--location-2-line' : undefined,
      website: undefined,
      linkedin: undefined,
      github: undefined,
    };
    const nextClass = classMap[type];
    if (nextClass) iconEl.className = nextClass;
  }
}

function contactSectionHasValue(section: Element, type: ContactType, value: string): boolean {
  const text = extractText(section).toLowerCase();
  if (type === 'phone') {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 7 && text.replace(/\D/g, '').includes(digits);
  }
  if (type === 'email') {
    return text.includes(value.toLowerCase());
  }
  if (type === 'website' || type === 'linkedin' || type === 'github') {
    const normalized = normalizeUrlForDisplay(value).toLowerCase();
    return text.includes(normalized);
  }
  if (type === 'location') {
    return text.includes(value.toLowerCase());
  }
  return false;
}

function findDedicatedContactSection(doc: Document): Element | null {
  const sections = doc.querySelectorAll('.section, section, .left-section, .right-section, [class*="section"]');
  for (const section of Array.from(sections)) {
    const titleEl = section.querySelector('.section-title, h2, h3, h4');
    if (titleEl && /contact/i.test(extractText(titleEl))) {
      return section;
    }
  }
  for (const section of Array.from(sections)) {
    if (section.querySelector('.contact-item')) {
      return section;
    }
  }
  return null;
}

function ensureContactItem(
  doc: Document,
  contactSection: Element,
  type: ContactType,
  value: string,
  styleText: string
): void {
  if (contactSectionHasValue(contactSection, type, value)) return;
  const templateRow = findContactTemplateRow(contactSection);
  let newRow: Element;
  if (templateRow) {
    newRow = cloneElement(templateRow);
    const iconEl = findContactIconElement(newRow);
    if (iconEl) updateContactIcon(iconEl, type, styleText);
  } else {
    newRow = doc.createElement('div');
    newRow.className = 'contact-item';
    const iconEl = createContactIconElement(doc, type, styleText);
    if (iconEl) newRow.appendChild(iconEl);
  }
  const displayValue = (type === 'website' || type === 'linkedin' || type === 'github')
    ? normalizeUrlForDisplay(value)
    : value;
  const link = newRow.querySelector('a');
  if (link) {
    if (type === 'email') link.setAttribute('href', `mailto:${value}`);
    else if (type === 'phone') link.setAttribute('href', `tel:${value}`);
    else link.setAttribute('href', value.startsWith('http') ? value : `https://${value}`);
    link.textContent = displayValue;
  } else {
    setContactItemValue(newRow, displayValue);
  }
  contactSection.appendChild(newRow);
}

function isBlueSimpleProfileTemplate(doc: Document): boolean {
  return !!(doc.querySelector('.header-bg') && doc.querySelector('.footer-bg') && doc.querySelector('.header-text'));
}

function isAccentColorMinimalTemplate(doc: Document): boolean {
  return !!(
    doc.querySelector('.header-title') &&
    doc.querySelector('.profile-pic') &&
    doc.querySelector('.section-content .left-column') &&
    doc.querySelector('.section-content .right-column')
  );
}

function renderAccentColorMinimalExperience(doc: Document, data: ResumeData): boolean {
  const expSection = findSection(doc, ['experience', 'work', 'employment', 'professional']);
  if (!expSection) return false;
  const parent = expSection.parentElement;
  if (!parent) return false;

  const templateSection = cloneElement(expSection);

  // Remove experience block sections (first + trailing no-title sections)
  let after = expSection.nextElementSibling as Element | null;
  while (after && after.classList.contains('section') && !after.querySelector('.section-title')) {
    const next = after.nextElementSibling as Element | null;
    after.remove();
    after = next;
  }
  expSection.remove();

  const experiences = data.experience || [];
  if (experiences.length === 0) return true;

  for (let i = 0; i < experiences.length; i++) {
    const exp = experiences[i];
    const sectionEl = cloneElement(templateSection);
    if (i > 0) {
      const titleEl = sectionEl.querySelector('.section-title');
      if (titleEl) titleEl.remove();
      sectionEl.classList.add('no-title');
    }
    renderExperienceItem(sectionEl, exp);
    parent.insertBefore(sectionEl, after || null);
  }
  return true;
}

function removeEmptyResponsibilitiesTitles(doc: Document): void {
  if (!isBlueSimpleProfileTemplate(doc)) return;
  const titles = doc.querySelectorAll('.responsibilities-title');
  titles.forEach(titleEl => {
    const parent = titleEl.parentElement;
    const next = titleEl.nextElementSibling;
    const list = (next && (next.tagName === 'UL' || next.classList.contains('responsibilities-list')))
      ? next
      : parent?.querySelector('ul.responsibilities-list, ul');
    if (!list) {
      titleEl.remove();
      return;
    }
    const hasContent = Array.from(list.querySelectorAll('li'))
      .some(li => (li.textContent || '').trim().length > 0);
    if (!hasContent) {
      list.remove();
      titleEl.remove();
    }
  });
}

function setTextAfterIcon(row: Element, value: string): void {
  const icon = row.querySelector('svg, img, i');
  if (!icon) {
    row.textContent = value;
    return;
  }
  // Remove all non-icon nodes, then append text node after icon
  Array.from(row.childNodes).forEach(node => {
    if (node !== icon) node.remove();
  });
  row.appendChild(row.ownerDocument!.createTextNode(` ${value}`));
}

function fixMinimalistSimplePhotoHeader(doc: Document, data: ResumeData): void {
  const styleText = Array.from(doc.querySelectorAll('style'))
    .map(style => style.textContent || '')
    .join(' ');
  const looksLikeMinimalist =
    styleText.includes('.contact-info') &&
    styleText.includes('.header-left') &&
    styleText.includes('.header-right img') &&
    styleText.includes('.column-left');
  if (!looksLikeMinimalist) return;

  const header = doc.querySelector('.header');
  if (!header) return;
  let headerLeft = header.querySelector('.header-left') as Element | null;
  let headerRight = header.querySelector('.header-right') as Element | null;
  if (!headerLeft) {
    headerLeft = doc.createElement('div');
    headerLeft.className = 'header-left';
    header.prepend(headerLeft);
  }
  if (!headerRight) {
    headerRight = doc.createElement('div');
    headerRight.className = 'header-right';
    header.appendChild(headerRight);
  }

  const name = data.profile?.name?.trim();
  const title = data.profile?.title?.trim();

  // If header-left accidentally contains the profile image, move it to header-right
  const misplacedImg = headerLeft.querySelector('img');
  if (misplacedImg) {
    misplacedImg.remove();
    if (!headerRight.querySelector('img')) {
      headerRight.appendChild(misplacedImg);
    }
  }

  // Ensure photo is present in right column if available
  const photoUrl = data.profile?.photo?.trim();
  if (photoUrl && !headerRight.querySelector('img')) {
    const img = doc.createElement('img');
    img.setAttribute('src', photoUrl);
    img.setAttribute('alt', name || 'Profile photo');
    headerRight.appendChild(img);
  }

  // Ensure name/title exist in left column
  if (name) {
    let h1 = headerLeft.querySelector('h1');
    if (!h1) {
      h1 = doc.createElement('h1');
      headerLeft.prepend(h1);
    }
    h1.textContent = name;
  }
  if (title) {
    let h2 = headerLeft.querySelector('h2');
    if (!h2) {
      h2 = doc.createElement('h2');
      const afterH1 = headerLeft.querySelector('h1');
      if (afterH1?.nextSibling) {
        headerLeft.insertBefore(h2, afterH1.nextSibling);
      } else {
        headerLeft.appendChild(h2);
      }
    }
    h2.textContent = title;
  }

  const contactInfo = headerLeft.querySelector('.contact-info') || (() => {
    const div = doc.createElement('div');
    div.className = 'contact-info';
    headerLeft.appendChild(div);
    return div;
  })();

  const contactValues: Array<{ type: ContactType; value?: string }> = [
    { type: 'phone', value: data.profile?.phone },
    { type: 'email', value: data.profile?.email },
    { type: 'location', value: data.profile?.location },
    { type: 'website', value: data.profile?.website },
    { type: 'linkedin', value: data.profile?.linkedin },
    { type: 'github', value: data.profile?.github },
  ];

  const existingRows = Array.from(contactInfo.querySelectorAll('p'));
  const templateRow = existingRows[0] || null;
  for (const { value } of contactValues) {
    if (!value) continue;
    if (extractText(contactInfo).includes(value)) continue;
    const row = templateRow ? (cloneElement(templateRow) as Element) : doc.createElement('p');
    setTextAfterIcon(row, value);
    contactInfo.appendChild(row);
  }
}

/**
 * Render profile/contact information
 */
function renderProfile(doc: Document, data: ResumeData): void {
  const { profile } = data;

  // Render name - comprehensive selectors - replace ALL matches to ensure no placeholder remains.
  // Only set when profile.name is truthy so we never overwrite the template with empty/undefined.
  const displayName = profile.name?.trim();
  if (displayName) {
    const nameSelectors = [
      '.header .name',  // KUSE / templates where name is inside .header (prefer first)
      '.name',
      'h1',
      '.profile-name',
      '.header-text',
      '.header-left h1',
      '.right-header h1',
      '.name-title h1',  // ModernProfessional
      '.name-title .name',  // ModernProfessional variant
    ];
    let nameRendered = false;
    for (const selector of nameSelectors) {
      const nameElements = doc.querySelectorAll(selector);
      if (nameElements.length > 0) {
        nameElements.forEach(nameEl => {
          // Only replace if it's not a section title or other non-name element
          if (!nameEl.classList.contains('section-title') &&
              !nameEl.classList.contains('company-name') &&
              !nameEl.classList.contains('school-name') &&
              !nameEl.classList.contains('reference-name')) {
            nameEl.textContent = displayName;
            nameRendered = true;
          }
        });
        if (nameRendered) break;
      }
    }
  }
  
  
  
  // Render title - comprehensive selectors
  if (profile.title) {
    const titleSelectors = [
      '.job-title',
      '.title',
      '.role',
      '.subtitle',
      '.header-left .title',
      '.header-left h2',  // MinimalistSimplePhoto
      'h2:not(.section-title)',  // MinimalistSimplePhoto h2
      '.header p',  // Template2ColumnMinimal (title is in .header p, after h1 name)
    ];
    for (const selector of titleSelectors) {
      const titleEl = doc.querySelector(selector);
      if (titleEl && !titleEl.classList.contains('section-title') && !titleEl.classList.contains('item-title')) {
        titleEl.textContent = profile.title;
        break;
      }
    }
  }
  
  // Render location — only when we have real data (undefined/empty = don't show)
  const hasLocationForFill = hasRealValue(profile.location);
  if (hasLocationForFill) {
    const locationSelectors = ['.location', '.address', '.contact-item.contact-location'];
    for (const selector of locationSelectors) {
      const locationEl = doc.querySelector(selector);
      if (locationEl) {
        if (locationEl.classList.contains('contact-item')) {
          setContactItemValue(locationEl, profile.location!);
        } else {
          locationEl.textContent = profile.location!;
        }
        break;
      }
    }
  }
  
  // Render contact info - comprehensive selectors
  const contactSelectors = ['.contact-info', '.contact', '.header', '.header-info', '.header-right', '.footer'];
  let contactSection: Element | null = null;
  for (const selector of contactSelectors) {
    contactSection = doc.querySelector(selector);
    if (contactSection) break;
  }
  
  // Fallback: find section with "Contact" title (ElegantProfessionalPhoto, BlueSimpleProfile, etc.)
  if (!contactSection) {
    const sections = doc.querySelectorAll('.section, section, .left-section, [class*="section"]');
    for (const section of Array.from(sections)) {
      const titleEl = section.querySelector('.section-title, h2, h3');
      if (titleEl && /contact/i.test(extractText(titleEl))) {
        contactSection = section;
        break;
      }
    }
  }
  // Fallback: any section containing .contact-item (covers all template structures)
  if (!contactSection) {
    const sections = doc.querySelectorAll('.section, section, [class*="section"]');
    for (const section of Array.from(sections)) {
      if (section.querySelector('.contact-item')) {
        contactSection = section;
        break;
      }
    }
  }
  const dedicatedContactSection = findDedicatedContactSection(doc);
  const targetContactSection = dedicatedContactSection || contactSection;
  const hasPhone = hasRealValue(profile.phone);
  const hasEmail = hasRealValue(profile.email);
  const hasLocation = hasRealValue(profile.location);
  const hasWebsite = hasRealValue(profile.website);
  const hasLinkedin = hasRealValue(profile.linkedin);
  const hasGithub = hasRealValue(profile.github);
  if (targetContactSection) {
    // Email (only fill when real data, not placeholder)
    if (hasEmail) {
      let emailRendered = false;
      
      // Try mailto links first
      const emailLinks = targetContactSection.querySelectorAll('a[href^="mailto:"]');
      if (emailLinks.length > 0) {
        emailLinks[0].setAttribute('href', `mailto:${profile.email!}`);
        emailLinks[0].textContent = profile.email!;
        // Remove CloudFlare email protection if present
        emailLinks[0].removeAttribute('data-cfemail');
        emailLinks[0].classList.remove('__cf_email__');
        emailRendered = true;
      }
      
      // Try CloudFlare protected emails
      if (!emailRendered) {
        const cfEmails = targetContactSection.querySelectorAll('.__cf_email__, [data-cfemail]');
        if (cfEmails.length > 0) {
          // Find the closest parent span
          let parent = cfEmails[0].closest('span');
          if (parent) {
            parent.innerHTML = profile.email!;
            emailRendered = true;
          }
        }
      }
      
      // Try contact-email class
      if (!emailRendered) {
        const emailEl = targetContactSection.querySelector('.contact-email, .contact-item.contact-email');
        if (emailEl) {
          setContactItemValue(emailEl, profile.email!);
          emailRendered = true;
        }
      }
      
      // Fallback: Find any element containing an email pattern and replace it (never use "first span" - that can be the phone row)
      if (!emailRendered) {
        const allElements = targetContactSection.querySelectorAll('span, a, div, p');
        for (const el of Array.from(allElements)) {
          const text = extractText(el);
          if (text && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) {
            el.textContent = profile.email!;
            if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('http')) {
              el.setAttribute('href', `mailto:${profile.email!}`);
            }
            emailRendered = true;
            break;
          }
        }
      }
    }
    
    // Phone — only fill when we have real data (undefined = remove row)
    if (hasPhone) {
      let phoneRendered = false;
      const phoneEl = targetContactSection.querySelector('.contact-phone, .contact-item.contact-phone');
      if (phoneEl) {
        setContactItemValue(phoneEl, profile.phone!);
        phoneRendered = true;
      }
      if (!phoneRendered) {
        const allText = targetContactSection.querySelectorAll('span, a, div, p');
        for (const el of Array.from(allText)) {
          const text = extractText(el);
          if (/\d{3}[-.)]\s*\d{3}[-.)]\s*\d{4}/.test(text) ||
              /\(\d{3}\)\s*\d{3}[-\s]\d{4}/.test(text) ||
              /\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text) ||
              el.getAttribute('href')?.startsWith('tel:')) {
            el.textContent = profile.phone!;
            if (el.tagName === 'A') {
              el.setAttribute('href', `tel:${profile.phone!}`);
            }
            phoneRendered = true;
            break;
          }
        }
      }
    }
    
    // LinkedIn
    if (profile.linkedin) {
      let linkedinRendered = false;
      const linkedinLinks = Array.from(targetContactSection.querySelectorAll('a')).find(a =>
        a.getAttribute('href')?.includes('linkedin.com')
      );
      if (linkedinLinks) {
        linkedinLinks.setAttribute('href', profile.linkedin);
        linkedinLinks.textContent = profile.linkedin.replace(/^https?:\/\//, '');
        linkedinRendered = true;
      }
      
      
    }
    
    // GitHub
    if (profile.github) {
      let githubRendered = false;
      const githubLinks = Array.from(targetContactSection.querySelectorAll('a')).find(a =>
        a.getAttribute('href')?.includes('github.com')
      );
      if (githubLinks) {
        githubLinks.setAttribute('href', profile.github);
        githubLinks.textContent = profile.github.replace(/^https?:\/\//, '');
        githubRendered = true;
      }
      
      
    }
    
    // Website (only fill when real data, not placeholder)
    if (hasWebsite) {
      let websiteRendered = false;
      const websiteLinks = Array.from(targetContactSection.querySelectorAll('a')).find(a => {
        const href = a.getAttribute('href');
        return href && !href.includes('linkedin.com') && !href.includes('github.com') && !href.startsWith('mailto:') && !href.startsWith('tel:');
      });
      if (websiteLinks) {
        websiteLinks.setAttribute('href', profile.website!);
        websiteLinks.textContent = profile.website!.replace(/^https?:\/\//, '');
        websiteRendered = true;
      } else {
        // Try contact-web class
        const webEl = targetContactSection.querySelector('.contact-web, .contact-item.contact-web');
        if (webEl) {
          setContactItemValue(webEl, profile.website!.replace(/^https?:\/\//, ''));
          websiteRendered = true;
        }
      }
    }
  }

  // Add missing contact rows for present data so icons show up (template often has only email placeholder)
  if (targetContactSection && isLikelyContactSection(targetContactSection)) {
    const styleText = Array.from(doc.querySelectorAll('style'))
      .map(style => style.textContent || '')
      .join(' ');
    if (hasEmail && profile.email) ensureContactItem(doc, targetContactSection, 'email', profile.email, styleText);
    if (hasPhone && profile.phone) ensureContactItem(doc, targetContactSection, 'phone', profile.phone, styleText);
    if (hasLocation && profile.location) ensureContactItem(doc, targetContactSection, 'location', profile.location, styleText);
    if (hasWebsite && profile.website) ensureContactItem(doc, targetContactSection, 'website', profile.website, styleText);
    if (hasLinkedin && profile.linkedin) ensureContactItem(doc, targetContactSection, 'linkedin', profile.linkedin, styleText);
    if (hasGithub && profile.github) ensureContactItem(doc, targetContactSection, 'github', profile.github, styleText);
  }

  // Remove contact rows when no data (undefined/empty = remove)
  const contactRowSelector = '.contact-item, .contact-info > div';
  if (targetContactSection) {
    if (!hasPhone) {
      targetContactSection.querySelectorAll('.contact-phone, .contact-item.contact-phone').forEach(el => el.remove());
      targetContactSection.querySelectorAll(contactRowSelector).forEach(el => {
        const text = extractText(el).trim();
        if (text && (/\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text) || isPlaceholderText(text))) el.remove();
      });
    }
    if (!hasEmail) {
      targetContactSection.querySelectorAll('.contact-email, .contact-item.contact-email').forEach(el => el.remove());
      targetContactSection.querySelectorAll(contactRowSelector).forEach(el => {
        const text = extractText(el).trim();
        if (text && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text) && isPlaceholderText(text)) el.remove();
      });
    }
    if (!hasLocation) {
      targetContactSection.querySelectorAll('.contact-location, .contact-item.contact-location').forEach(el => el.remove());
      targetContactSection.querySelectorAll(contactRowSelector).forEach(el => {
        const text = extractText(el).trim();
        if (text && (/123\s+anywhere|any\s+city(?:\s*,?\s*st\s*\d{5})?/i.test(text) || isPlaceholderText(text))) el.remove();
      });
    }
    if (!hasWebsite) {
      targetContactSection.querySelectorAll('.contact-web, .contact-item.contact-web').forEach(el => el.remove());
    }
  }

  // Fallback: title-based contact sections — remove when no data
  if (!contactSection) {
    const allSections = doc.querySelectorAll('.section, section, [class*="section"]');
    for (const section of Array.from(allSections)) {
      const titleEl = section.querySelector('.section-title, h2, h3');
      if (!titleEl) continue;
      const titleText = extractText(titleEl).toLowerCase();
      const p = section.querySelector('p');
      if (titleText.includes('phone')) {
        if (hasPhone && p) p.textContent = profile.phone!;
        else if (!hasPhone) section.remove();
      } else if (titleText.includes('email')) {
        if (hasEmail && p) p.textContent = profile.email!;
        else if (!hasEmail) section.remove();
      } else if (titleText.includes('website')) {
        if (hasWebsite && p) p.textContent = profile.website!.replace(/^https?:\/\//, '');
        else if (!hasWebsite) section.remove();
      } else if (titleText.includes('address') || titleText.includes('location')) {
        if (hasLocation && p) p.textContent = profile.location!;
        else if (!hasLocation) section.remove();
      }
    }
  }
  
  // Render photo - comprehensive selectors so user's image replaces template placeholder
  if (profile.photo) {
    const photoSelectors = [
      '.profile-pic',
      '.profile-photo',
      '.headshot',
      '.profile-pic-container img',
      '.image-container img:not(.icon)',
      'img[class*="profile"]',
      'img[class*="photo"]',
      '.header img',
      '.header-right img',
    ];
    for (const selector of photoSelectors) {
      const img = doc.querySelector(selector);
      if (img?.tagName === 'IMG' && !img.classList.contains('icon')) {
        img.setAttribute('src', profile.photo);
        break;
      }
    }
  }
  
}




/**
 * Render summary section
 */
function renderSummary(doc: Document, data: ResumeData): void {
  if (!data.summary || !data.summary.text) {
    const summarySection = findSection(doc, ['summary', 'about', 'profile', 'objective']);
    if (summarySection) summarySection.remove();
    return;
  }
  
  let summaryRendered = false;
  
  // --- Step A: Always update header tagline paragraphs (e.g. ColorfulBlocks .header p) ---
  // These are brief summary/taglines that sit inside the header alongside the name.
  // We update them first, separately from the main summary section, so they always
  // reflect real data even when a dedicated summary section also exists.
  const headerParagraphs = doc.querySelectorAll('.header p');
  for (const p of Array.from(headerParagraphs)) {
    // Skip subtitle, contact-info children, and short all-caps titles
    const text = extractText(p);
    const looksLikeTitle = text && text === text.toUpperCase() && text.length < 100;
    
    if (!p.closest('.contact-info') && !p.classList.contains('subtitle') && !looksLikeTitle) {
      p.textContent = data.summary.text;
      summaryRendered = true;
      break; // Only update the first matching header paragraph
    }
  }
  
  // --- Step B: Update dedicated summary sections (.summary-list, .about-me, etc.) ---
  const summarySelectors = [
    '.summary',
    '.about',
    '.profile-summary',
    '.about-me',
    '.about-me-text',
    '.about-me p',  // OliveGreenModern
    '.section.about-me p',  // OliveGreenModern variant
    '.summary-list',  // ColorfulBlocks (list format)
  ];
  for (const selector of summarySelectors) {
    const summaryElements = doc.querySelectorAll(selector);
    if (summaryElements.length > 0) {
      summaryElements.forEach(summaryEl => {
        // Don't replace section titles or subtitle
        if (!summaryEl.classList.contains('section-title') && 
            !summaryEl.classList.contains('subtitle') &&
            !summaryEl.closest('.section-title') && data.summary) {
          
          // Handle list format (ColorfulBlocks)
          if (summaryEl.tagName === 'UL' || summaryEl.classList.contains('summary-list')) {
            // Split summary text into sentences for list items
            const sentences = data.summary.text.match(/[^.!?]+[.!?]+/g) || [data.summary.text];
            summaryEl.innerHTML = '';
            const ownerDoc = summaryEl.ownerDocument || document;
            sentences.forEach(sentence => {
              const li = ownerDoc.createElement('li');
              li.textContent = sentence.trim();
              summaryEl.appendChild(li);
            });
          } else {
            // Handle paragraph format
            summaryEl.textContent = data.summary.text;
          }
          summaryRendered = true;
        }
      });
      if (summaryRendered) {
        return;
      }
    }
  }
  
  // Try to find by section title
  const sections = doc.querySelectorAll('.section, section, [class*="section"]');
  for (const section of Array.from(sections)) {
    const titleEl = section.querySelector('.section-title, h2, h3');
    if (titleEl && /summary|about|profile|objective|personal profile/i.test(extractText(titleEl))) {
      // More specific selector - prefer dedicated summary classes
      // Avoid matching work-item or experience-item descriptions
      let contentEl = section.querySelector('.summary, .about-me-text');
      
      // If not found, try to find a paragraph that's not inside a work/experience item
      if (!contentEl) {
        const paragraphs = section.querySelectorAll('p');
        for (const p of Array.from(paragraphs)) {
          // Skip if it's a section title or inside a work/experience item
          if (!p.classList.contains('section-title') && 
              !p.closest('.work-item') && 
              !p.closest('.experience-item')) {
            contentEl = p;
            break;
          }
        }
      }
      
      // Don't overwrite the title
      if (contentEl && contentEl !== titleEl) {
        contentEl.textContent = data.summary.text;
        return;
      }
    }
  }
  
}

/**
 * Render experience section
 */
function renderExperience(doc: Document, data: ResumeData): void {
  if (!data.experience || data.experience.length === 0) {
    const expSection = findSection(doc, ['experience', 'work', 'employment', 'professional']);
    if (expSection) expSection.remove();
    return;
  }
  
  if (isAccentColorMinimalTemplate(doc)) {
    if (renderAccentColorMinimalExperience(doc, data)) return;
  }

  const experienceSection = findSection(doc, ['experience', 'work', 'employment', 'professional']);
  if (!experienceSection) return;
  
  // Find template item - comprehensive selectors
  // .section-content is used by AccentColorMinimal (split left/right columns)
  let templateItem = experienceSection.querySelector('.experience-item, .job, .timeline-item, .work-item, .two-col-section, .section-content, [class*="experience"]');
  
  // Handle FLAT experience structure (ElegantProfessionalPhoto)
  // where items are h4.job-title + p.job-details + ul.job-description siblings without a wrapper
  if (!templateItem) {
    const flatJobTitles = experienceSection.querySelectorAll('h4.job-title, h4');
    if (flatJobTitles.length > 0) {
      renderFlatExperience(experienceSection, data.experience);
      return;
    }
    return;
  }
  
  // Also look for timeline wrapper (Template2ColumnTimeline has items inside .timeline container)
  const timelineContainer = experienceSection.querySelector('.timeline');
  const parentContainer = timelineContainer || experienceSection;
  
  // Clear existing items - comprehensive selectors
  const allItems = parentContainer.querySelectorAll('.experience-item, .job, .timeline-item, .work-item, .two-col-section, .section-content');
  allItems.forEach(item => item.remove());
  
  // Render each experience item
  for (const exp of data.experience) {
    const itemEl = cloneElement(templateItem);
    renderExperienceItem(itemEl, exp);
    parentContainer.appendChild(itemEl);
  }
}

/**
 * Render experience in flat structure (no item wrappers)
 * Used by ElegantProfessionalPhoto and similar templates
 */
function renderFlatExperience(section: Element, items: ExperienceItem[]): void {
  const ownerDoc = section.ownerDocument || document;
  
  // Find the section title to preserve it
  const titleEl = section.querySelector('.section-title, h2, h3');
  
  // Remove all child elements except the title
  const children = Array.from(section.children);
  for (const child of children) {
    if (child !== titleEl) {
      child.remove();
    }
  }
  
  // Render each experience item as flat h4 + p + ul
  for (const exp of items) {
    const h4 = ownerDoc.createElement('h4');
    h4.className = 'job-title';
    h4.textContent = exp.title;
    section.appendChild(h4);
    
    const details = ownerDoc.createElement('p');
    details.className = 'job-details';
    const dateText = exp.endDate ? `${exp.startDate} - ${exp.endDate}` : exp.startDate;
    details.textContent = `${exp.company}${exp.location ? ', ' + exp.location : ''} | ${dateText}`;
    section.appendChild(details);
    
    if (exp.bullets && exp.bullets.length > 0) {
      const ul = ownerDoc.createElement('ul');
      ul.className = 'job-description';
      for (const bullet of exp.bullets) {
        const li = ownerDoc.createElement('li');
        li.textContent = bullet;
        ul.appendChild(li);
      }
      section.appendChild(ul);
    }
  }
  
}

/**
 * Render a single experience item
 */
function renderExperienceItem(element: Element, data: ExperienceItem): void {
  // Render title - comprehensive selectors
  const titleSelectors = [
    '.job-title',
    '.title',
    '.position',
    '.role',
    '.item-title',  // ModernProfessional
    '.item-titl',  // AccentColorMinimal (typo in template)
    'h3',
    'h4'
  ];
  let titleRendered = false;
  for (const selector of titleSelectors) {
    const titleEl = element.querySelector(selector);
    if (titleEl && !titleEl.classList.contains('section-title') && !titleEl.classList.contains('responsibilities-title')) {
      // For AccentColorMinimal: .item-title exists in both left (title) and right (company) columns
      // Use the one in .left-column first
      const leftCol = element.querySelector('.left-column');
      if (leftCol && selector === '.item-title') {
        const leftTitle = leftCol.querySelector('.item-title, .item-titl');
        if (leftTitle) {
          leftTitle.textContent = data.title;
          titleRendered = true;
          break;
        }
      }
      titleEl.textContent = data.title;
      titleRendered = true;
      break;
    }
  }
  
  // Render company - comprehensive selectors
  const companySelectors = [
    '.company',
    '.company-name',
    '.organization',
    '.company-location',
    '.date-company',
    '.job-details',  // ElegantProfessionalPhoto
    '.item-subtitle',  // ModernProfessional
    '.right-column .item-title',  // AccentColorMinimal (company in right column)
    '.details',  // OliveGreenModern, Template2ColumnStylishBlocks
  ];
  let companyRendered = false;
  for (const selector of companySelectors) {
    const companyEl = element.querySelector(selector);
    if (companyEl) {
      let text = data.company;
      if (data.location) {
        text += ` — ${data.location}`;
      }
      
      // For date-company fields, prepend date
      if (selector === '.date-company') {
        const dateText = data.endDate ? `${data.startDate} - ${data.endDate}` : data.startDate;
        text = `${dateText}\n${text}`;
      }
      
      // For job-details fields (ElegantProfessionalPhoto), include date
      if (selector === '.job-details') {
        const dateText = data.endDate ? `${data.startDate} - ${data.endDate}` : data.startDate;
        text = `${text} | ${dateText}`;
      }
      
      // For .details: if title was NOT rendered separately, combine title + company
      if (selector === '.details' && !titleRendered) {
        text = `${data.title} | ${data.company}`;
        if (data.location) {
          text += ` | ${data.location}`;
        }
      }
      
      companyEl.textContent = text;
      companyRendered = true;
      break;
    }
  }
  
  // Fallback: BandwProfessional uses .left-col with plain <p> for company
  if (!companyRendered) {
    const leftCol = element.querySelector('.left-col');
    if (leftCol) {
      const paragraphs = leftCol.querySelectorAll('p');
      // The first <p> that's NOT .date gets the company
      for (const p of Array.from(paragraphs)) {
        if (!p.classList.contains('date')) {
          p.textContent = data.company;
          if (data.location) {
            p.textContent += `, ${data.location}`;
          }
          companyRendered = true;
          break;
        }
      }
    }
  }
  
  // Render dates - comprehensive selectors
  const dateSelectors = [
    '.date',
    '.dates',
    '.job-date',
    '.period',
    '.duration',
    '.item-date',  // ModernProfessional, AccentColorMinimal
    '.date-badge',  // ColorfulBlocks
  ];
  for (const selector of dateSelectors) {
    const dateEl = element.querySelector(selector);
    if (dateEl && !dateEl.classList.contains('date-company')) {
      const dateText = data.endDate
        ? `${data.startDate} - ${data.endDate}`
        : data.startDate;
      dateEl.textContent = dateText;
      break;
    }
  }
  
  // Bullet list selectors (experience/description lists only - not skills, etc.)
  const bulletListSelectors = '.achievements, .bullets, .item-description, .responsibilities-list, .experience-list, .job-description';
  const allBulletContainers = Array.from(element.querySelectorAll(bulletListSelectors));
  // Also include bare ul that are likely description lists (not inside a nav/skills context)
  const bareUls = Array.from(element.querySelectorAll('ul')).filter(
    ul => !ul.closest('.skills-list, .summary-list') && !allBulletContainers.includes(ul)
  );
  const bulletContainers = allBulletContainers.length > 0 ? allBulletContainers : bareUls;

  const cleanBullets = (data.bullets || []).map(b => b.trim()).filter(Boolean);
  const hasBullets = cleanBullets.length > 0;
  if (hasBullets && bulletContainers.length > 0) {
    const bulletsContainer = bulletContainers[0];
    // .item-description (e.g. ModernProfessional): use <ul><li> so bullets always show; replace <p> with <div> so structure is valid
    if (bulletsContainer.classList.contains('item-description')) {
      const ownerDoc = bulletsContainer.ownerDocument || document;
      let container: Element = bulletsContainer;
      if (bulletsContainer.tagName === 'P') {
        const div = ownerDoc.createElement('div');
        div.className = bulletsContainer.className;
        bulletsContainer.parentNode?.replaceChild(div, bulletsContainer);
        container = div;
      }
      container.innerHTML = '';
      const ul = ownerDoc.createElement('ul');
      ul.setAttribute('class', 'item-description-list');
      for (const bullet of cleanBullets) {
        const li = ownerDoc.createElement('li');
        li.textContent = bullet;
        ul.appendChild(li);
      }
      container.appendChild(ul);
    } else if (bulletsContainer.tagName === 'P') {
      bulletsContainer.textContent = cleanBullets.join('. ');
    } else {
      bulletsContainer.innerHTML = '';
      const ownerDoc = element.ownerDocument || document;
      for (const bullet of cleanBullets) {
        const li = ownerDoc.createElement('li');
        li.textContent = bullet;
        bulletsContainer.appendChild(li);
      }
    }
    // Remove any other bullet containers in this item so we don't show duplicate/empty lists
    for (let i = 1; i < bulletContainers.length; i++) {
      bulletContainers[i].remove();
    }
  } else {
    // No bullets: remove every bullet list container in this item so we don't show empty bullet points
    for (const el of bulletContainers) {
      el.remove();
    }
    // Blue simple profile: also remove the "Key responsibilities:" label when empty
    const doc = element.ownerDocument || document;
    if (isBlueSimpleProfileTemplate(doc)) {
      element.querySelectorAll('.responsibilities-title').forEach(el => el.remove());
    }
  }

  // Fallback: If no bullets container found but we have bullets, try to find/create one
  if (bulletContainers.length === 0 && cleanBullets.length > 0) {
    // Look for any <p> that might hold a description (not date, not title, not company)
    const descP = element.querySelector('p:not(.date):not(.job-title):not(.details):not(.job-details):not(.company):not(.responsibilities-title)');
    if (descP) {
      descP.textContent = cleanBullets.join('. ');
    }
  }
}

/**
 * Render education section
 */
function renderEducation(doc: Document, data: ResumeData): void {
  if (!data.education || data.education.length === 0) {
    const eduSection = findSection(doc, ['education', 'academic', 'education background']);
    if (eduSection) eduSection.remove();
    return;
  }
  
  const educationSection = findSection(doc, ['education', 'academic', 'education background']);
  if (!educationSection) return;
  
  // Comprehensive template item selectors
  const templateItem = educationSection.querySelector('.education-item, .school, .timeline-item, .two-col-section, .section-content, [class*="education"]');
  if (!templateItem) return;
  
  // Clear existing items - comprehensive selectors
  const allItems = educationSection.querySelectorAll('.education-item, .school, .timeline-item, .two-col-section, .section-content');
  allItems.forEach(item => item.remove());
  
  // Render each education item
  for (const edu of data.education) {
    const itemEl = cloneElement(templateItem);
    renderEducationItem(itemEl, edu);
    educationSection.appendChild(itemEl);
  }
}

/**
 * Render a single education item
 */
function renderEducationItem(element: Element, data: EducationItem): void {
  // Check if this is MinimalistSimplePhoto template (school in .item-title, degree in .item-subtitle)
  const isMinimalistPhoto = element.querySelector('.item-title') && element.querySelector('.item-subtitle') && 
                            !element.querySelector('.item-header');
  
  if (isMinimalistPhoto) {
    // MinimalistSimplePhoto: REVERSED - school in .item-title, degree in .item-subtitle
    const schoolEl = element.querySelector('.item-title');
    if (schoolEl) {
      schoolEl.textContent = data.school;
    }
    
    const degreeEl = element.querySelector('.item-subtitle');
    if (degreeEl) {
      degreeEl.textContent = data.degree;
    }
  } else {
    // Standard templates: degree in .item-title, school in .item-subtitle
    
    // Render school - comprehensive selectors
    const schoolSelectors = [
      '.school',
      '.school-name',
      '.university',
      '.institution',
      '.college',
      '.item-subtitle',  // ModernProfessional
      '.details',  // OliveGreenModern
      '.item-subheader span:first-child',  // ColorfulBlocks (first span in subheader)
    ];
    let schoolRendered = false;
    for (const selector of schoolSelectors) {
      const schoolEl = element.querySelector(selector);
      if (schoolEl) {
        let text = data.school;
        if (data.location && selector !== '.details' && !selector.includes('subheader')) {
          text += `, ${data.location}`;
        }
        schoolEl.textContent = text;
        schoolRendered = true;
        break;
      }
    }
    
    // Fallback: BandwProfessional / Template2ColumnTimeline use .left-col or plain <p> for school
    if (!schoolRendered) {
      const leftCol = element.querySelector('.left-col');
      if (leftCol) {
        // Find the <p> that's NOT the date
        const paragraphs = leftCol.querySelectorAll('p');
        for (const p of Array.from(paragraphs)) {
          if (!p.classList.contains('date')) {
            let text = data.school;
            if (data.location) text += `, ${data.location}`;
            p.textContent = text;
            schoolRendered = true;
            break;
          }
        }
      }
      
      // Template2ColumnTimeline education has plain <p> siblings without .left-col
      if (!schoolRendered) {
        const paragraphs = element.querySelectorAll('p');
        for (const p of Array.from(paragraphs)) {
          if (!p.classList.contains('date') && !p.classList.contains('degree') && !p.classList.contains('completed')) {
            let text = data.school;
            if (data.location) text += `, ${data.location}`;
            p.textContent = text;
            schoolRendered = true;
            break;
          }
        }
      }
    }
    
    // Render degree - comprehensive selectors
    const degreeSelectors = [
      '.degree',
      '.degree-info',
      '.major',
      '.field',
      '.item-title',  // ModernProfessional
      'h3',  // OliveGreenModern, BandwProfessional
      '.item-header .title',  // ColorfulBlocks
    ];
    let degreeRendered = false;
    for (const selector of degreeSelectors) {
      const degreeEl = element.querySelector(selector);
      if (degreeEl && !degreeEl.classList.contains('section-title')) {
        let text = data.degree;
        if (data.location && selector === '.degree-info') {
          text += ` — ${data.location}`;
        }
        degreeEl.textContent = text;
        degreeRendered = true;
        break;
      }
    }
  }
  
  // Render dates - comprehensive selectors
  const dateSelectors = [
    '.date',
    '.education-date',
    '.graduation',
    '.completed',  // BlueSimpleProfile
    '.item-date',
    '.date-badge',  // ColorfulBlocks
  ];
  for (const selector of dateSelectors) {
    const dateEl = element.querySelector(selector);
    if (dateEl) {
      const dateText = data.endDate
        ? `${data.startDate || ''} - ${data.endDate}`
        : data.endDate || data.startDate || '';
      dateEl.textContent = dateText;
      break;
    }
  }
  
  // Render GPA if present
  if (data.gpa) {
    const text = element.textContent || '';
    if (text.includes('GPA')) {
      element.textContent = text.replace(/GPA:?\s*[\d.]+/i, `GPA: ${data.gpa}`);
    } else {
      // Try to add GPA to degree info
      const degreeEl = element.querySelector('.degree-info, .degree, .item-subtitle');
      if (degreeEl) {
        degreeEl.textContent += ` | GPA: ${data.gpa}`;
      }
    }
  }
}

/**
 * Render skills section
 */
function renderSkills(doc: Document, data: ResumeData): void {
  if (!data.skills || (!data.skills.groups?.length && !data.skills.items?.length)) {
    const skillsSection = findSection(doc, ['skill', 'expertise', 'competenc', 'technical', 'technologies']);
    if (skillsSection) skillsSection.remove();
    return;
  }
  
  // Try multiple keywords to find skills section
  const skillsSection = findSection(doc, ['skill', 'expertise', 'competenc', 'technical', 'technologies', 'proficienc']);
  if (!skillsSection) {
    console.warn('[renderSkills] Could not find skills section in template');
    return;
  }
  
  console.log(`[renderSkills] Found skills section, populating ${data.skills.items?.length || data.skills.groups?.length || 0} skills`);
  
  // CRITICAL: Clear ALL hardcoded/placeholder skills FIRST, before any population
  // This must happen for both grouped and flat skills, including progress bars and expertise items
  
  // 1. Clear all expertise-item elements (progress bars with soft skills)
  const expertiseItems = skillsSection.querySelectorAll('.expertise-item, .skill-item, [class*="expertise-item"], [class*="skill-item"]');
  if (expertiseItems.length > 0) {
    console.log(`[renderSkills] Found ${expertiseItems.length} expertise-item elements, removing them`);
    expertiseItems.forEach(item => {
      // Only remove if not in section title
      if (!item.closest('.section-title') && !item.closest('h2') && !item.closest('h3')) {
        item.remove();
      }
    });
  }
  
  // 2. Clear all <ul> elements and their <li> items
  const allUlsInSection = skillsSection.querySelectorAll('ul');
  console.log(`[renderSkills] Found ${allUlsInSection.length} <ul> elements, clearing all existing <li> items`);
  
  allUlsInSection.forEach((ul, idx) => {
    const listItems = ul.querySelectorAll('li');
    if (listItems.length > 0) {
      console.log(`[renderSkills] Clearing ${listItems.length} hardcoded skills from UL ${idx + 1}:`, 
        Array.from(listItems).slice(0, 3).map(li => li.textContent?.trim()).filter(Boolean));
    }
    
    // Clear innerHTML completely - this removes ALL hardcoded skills
    const isInTitle = ul.closest('h2, h3, .section-title');
    if (!isInTitle) {
      ul.innerHTML = '';
      console.log(`[renderSkills] Cleared innerHTML of UL ${idx + 1}`);
    } else {
      // If somehow in a title, just remove the li items
      listItems.forEach(li => {
        if (!li.closest('.section-title')) {
          li.remove();
        }
      });
    }
  });
  
  // 3. Clear progress bars and proficiency indicators
  const progressBars = skillsSection.querySelectorAll('.expertise-bar, .expertise-level, .skill-bar, .proficiency-bar, [class*="progress"], [class*="bar"]');
  if (progressBars.length > 0) {
    console.log(`[renderSkills] Found ${progressBars.length} progress bar elements, removing them`);
    progressBars.forEach(bar => {
      if (!bar.closest('.section-title') && !bar.closest('h2') && !bar.closest('h3')) {
        bar.remove();
      }
    });
  }
  
  // 4. Clear expertise labels (text next to progress bars)
  const expertiseLabels = skillsSection.querySelectorAll('.expertise-label, .skill-label, [class*="expertise-label"]');
  if (expertiseLabels.length > 0) {
    console.log(`[renderSkills] Found ${expertiseLabels.length} expertise label elements, removing them`);
    expertiseLabels.forEach(label => {
      if (!label.closest('.section-title') && !label.closest('h2') && !label.closest('h3')) {
        label.remove();
      }
    });
  }
  
  // 5. Clear parent containers that might hold expertise items (but keep the container structure)
  // Find containers that have expertise-item children and clear their content
  const containersWithExpertise = skillsSection.querySelectorAll('.section-content, .bottom-right, .right-column, div[class*="skill"], div[class*="expertise"]');
  containersWithExpertise.forEach(container => {
    if (!container.closest('.section-title') && !container.closest('h2') && !container.closest('h3')) {
      // Check if this container has expertise items or progress bars
      const hasExpertiseItems = container.querySelector('.expertise-item, .skill-item, .expertise-bar, .expertise-label');
      if (hasExpertiseItems) {
        // Clear only the expertise-related content, but keep the container
        const itemsToRemove = container.querySelectorAll('.expertise-item, .skill-item, .expertise-bar, .expertise-label, .expertise-level');
        if (itemsToRemove.length > 0) {
          console.log(`[renderSkills] Removing ${itemsToRemove.length} expertise-related elements from container`);
          itemsToRemove.forEach(item => item.remove());
        }
      }
    }
  });
  
  // 6. Clear any text content in skills containers that might have comma-separated skills
  const skillsContainers = skillsSection.querySelectorAll('.skills-list, .skills, .expertise-list, p, span, div');
  skillsContainers.forEach(el => {
    if (!el.closest('.section-title') && !el.closest('ul') && !el.closest('h2') && !el.closest('h3') && 
        !el.closest('.expertise-item') && !el.closest('.skill-item')) {
      const text = extractText(el).toLowerCase();
      // Check for hardcoded skills patterns (both soft skills and technical skills)
      const hasHardcodedSkills = (
        text.includes('management skills') || 
        text.includes('negotiation') || 
        text.includes('critical thinking') || 
        text.includes('leadership') || 
        text.includes('digital marketing') ||
        text.includes('fashion illustration') ||
        text.includes('3d garment design') ||
        text.includes('textile') ||
        text.includes('pattern making') ||
        (text.includes(',') && (text.includes('illustration') || text.includes('design') || text.includes('programming') || text.includes('knowledge') || text.length > 20))
      );
      if (hasHardcodedSkills) {
        console.log(`[renderSkills] Clearing hardcoded skills from container:`, text.substring(0, 50));
        el.textContent = '';
        el.innerHTML = '';
      }
    }
  });
  
  // Handle grouped skills - comprehensive selectors
  if (data.skills.groups && data.skills.groups.length > 0) {
    
    const groupContainer = skillsSection.querySelector('.skills-group, .skill-group, .skills-grid')?.parentElement;
    if (groupContainer) {
      const templateGroup = skillsSection.querySelector('.skills-group, .skill-group, .skills-grid');
      if (templateGroup) {
        // Clear existing groups
        const allGroups = groupContainer.querySelectorAll('.skills-group, .skill-group, .skills-grid');
        allGroups.forEach(g => g.remove());
        
        // Render each group
        for (const group of data.skills.groups) {
          const groupEl = cloneElement(templateGroup);
          
          const categoryEl = groupEl.querySelector('.skills-category, .category, strong, b');
          if (categoryEl) {
            categoryEl.textContent = group.category + ':';
          }
          
          const skillsEl = groupEl.querySelector('.skills-list, .skills, .expertise-list');
          if (skillsEl) {
            skillsEl.textContent = group.skills.join(', ');
          }
          
          groupContainer.appendChild(groupEl);
        }
        return;
      }
    }
  }
  
  // Handle flat skills list - comprehensive selectors
  if (data.skills?.items && data.skills.items.length > 0) {
    const skillItems = data.skills.items;
    
    console.log(`[renderSkills] Starting to populate ${skillItems.length} skills:`, skillItems.slice(0, 5));
    
    // Note: Hardcoded skills were already cleared above, now we just populate
    
    // Check for skills-grid with multiple ULs (BandwProfessional)
    const skillsGrid = skillsSection.querySelector('.skills-grid');
    if (skillsGrid) {
      const uls = skillsGrid.querySelectorAll('ul');
      if (uls.length > 0) {
        // Clear all first
        uls.forEach(ul => ul.innerHTML = '');
        // Distribute skills evenly across existing ULs
        const itemsPerList = Math.ceil(skillItems.length / uls.length);
        const ownerDoc = skillsGrid.ownerDocument || document;
        uls.forEach((ul, idx) => {
          const start = idx * itemsPerList;
          const end = Math.min(start + itemsPerList, skillItems.length);
          for (let i = start; i < end; i++) {
            const li = ownerDoc.createElement('li');
            li.textContent = skillItems[i];
            ul.appendChild(li);
          }
        });
        console.log(`[renderSkills] Populated ${skillItems.length} skills across ${uls.length} ULs in skills-grid`);
        return;
      }
    }
    
    // Find ALL ul elements in the skills section (not just the first one)
    // We already cleared them above, now we populate
    const allUls = skillsSection.querySelectorAll('ul');
    if (allUls.length > 0) {
      // Use the first ul (or the one that's not in section-title)
      let targetUl: Element | null = null;
      for (const ul of Array.from(allUls)) {
        // Skip if it's part of a section title
        if (!ul.closest('.section-title') && !ul.closest('h2') && !ul.closest('h3')) {
          targetUl = ul;
          break;
        }
      }
      // Fallback to first ul if none found (but log a warning)
      if (!targetUl && allUls.length > 0) {
        targetUl = allUls[0];
        console.warn(`[renderSkills] Using first UL as fallback (might be in title)`);
      }
      
      if (targetUl) {
        // Double-check it's empty (should already be from above)
        if (targetUl.querySelectorAll('li').length > 0) {
          console.warn(`[renderSkills] UL still has ${targetUl.querySelectorAll('li').length} items, clearing again`);
          targetUl.innerHTML = '';
        }
        
        const ownerDoc = targetUl.ownerDocument || document;
        for (const skill of skillItems) {
          const li = ownerDoc.createElement('li');
          li.textContent = skill;
          targetUl.appendChild(li);
        }
        console.log(`[renderSkills] ✅ Successfully populated ${skillItems.length} skills as list items in UL`);
        console.log(`[renderSkills] Skills added:`, skillItems.slice(0, 10));
        
        // Verify the skills were actually added
        const verifyCount = targetUl.querySelectorAll('li').length;
        if (verifyCount !== skillItems.length) {
          console.error(`[renderSkills] ⚠️ Mismatch! Expected ${skillItems.length} skills but found ${verifyCount} in UL`);
        }
        return;
      } else {
        console.warn(`[renderSkills] Found ${allUls.length} ULs but couldn't select target UL`);
      }
    } else {
      console.warn(`[renderSkills] No <ul> elements found in skills section!`);
    }
    
    // Try other selectors for skills container (non-ul elements)
    const skillsEl = skillsSection.querySelector('.skills-list, .skills, .expertise-list, .skill-items, [class*="skill"]');
    if (skillsEl && skillsEl.tagName !== 'UL') {
      // Clear existing content
      skillsEl.innerHTML = '';
      skillsEl.textContent = skillItems.join(', ');
      console.log(`[renderSkills] Populated ${skillItems.length} skills as comma-separated text`);
      return;
    }
    
    // Fallback: Try to find any element that might contain skills (p, div, span)
    // and replace placeholder text with actual skills
    const allElements = skillsSection.querySelectorAll('p, div, span, td');
    for (const el of Array.from(allElements)) {
      const text = extractText(el).toLowerCase();
      // Check if this element contains placeholder skill-like text
      if (text.includes('skill') || text.includes('expertise') || text.includes('proficient') || 
          text.includes('javascript') || text.includes('python') || text.includes('java') ||
          /[a-z]+\s*,\s*[a-z]+/.test(text)) {
        // This might be a skills container - replace with actual skills
        el.textContent = skillItems.join(', ');
        console.log(`[renderSkills] Populated ${skillItems.length} skills in fallback element`);
        return;
      }
    }
    
    // Last resort: Create a new list if we found the section but no container
    const ownerDoc = skillsSection.ownerDocument || document;
    const ul = ownerDoc.createElement('ul');
    for (const skill of skillItems) {
      const li = ownerDoc.createElement('li');
      li.textContent = skill;
      ul.appendChild(li);
    }
    skillsSection.appendChild(ul);
    console.log(`[renderSkills] Created new list with ${skillItems.length} skills`);
  }
  
}

/**
 * Render projects section
 */
function renderProjects(doc: Document, data: ResumeData): void {
  if (!data.projects || data.projects.length === 0) {
    // Remove projects section if no data
    const projectsSection = findSection(doc, ['project']);
    if (projectsSection) {
      projectsSection.remove();
    }
    return;
  }
  
  const projectsSection = findSection(doc, ['project']);
  if (!projectsSection) return;
  
  const templateItem = projectsSection.querySelector('.project, .project-item, .experience-item');
  if (!templateItem) return;
  
  // Clear existing items - need to check all possible item classes
  const allItems = projectsSection.querySelectorAll('.project, .project-item, .experience-item');
  allItems.forEach(item => item.remove());
  
  // Render each project
  for (const project of data.projects) {
    const itemEl = cloneElement(templateItem);
    renderProjectItem(itemEl, project);
    projectsSection.appendChild(itemEl);
  }
}

/**
 * Render a single project item
 */
function renderProjectItem(element: Element, data: ProjectItem): void {
  // Render title - include .job-title for KUSE template
  const titleSelectors = ['.project-title', '.title', '.job-title', 'h3', 'h4'];
  for (const selector of titleSelectors) {
    const titleEl = element.querySelector(selector);
    if (titleEl) {
      if (data.url) {
        titleEl.innerHTML = `<a href="${data.url}" target="_blank">${data.title}</a>`;
      } else {
        titleEl.textContent = data.title;
      }
      break;
    }
  }
  
  // Render dates if present
  if (data.startDate || data.endDate) {
    const dateEl = element.querySelector('.job-date, .date, .project-date');
    if (dateEl) {
      const dateText = data.endDate 
        ? `${data.startDate || ''} - ${data.endDate}` 
        : data.startDate || data.endDate || '';
      dateEl.textContent = dateText;
    }
  }
  
  // Render organization/tech stack - include .degree-info for KUSE template
  if (data.organization) {
    const orgSelectors = ['.company', '.organization', '.subtitle', '.degree-info'];
    for (const selector of orgSelectors) {
      const orgEl = element.querySelector(selector);
      if (orgEl) {
        orgEl.textContent = data.organization;
        break;
      }
    }
  }
  
  // Render description - handle both text paragraphs and bullet lists
  const descEl = element.querySelector('.description, p');
  if (descEl && !descEl.classList.contains('degree-info')) {
    descEl.textContent = data.description || '';
  }
  
  // If template has achievements/bullets list, split description into bullets
  const bulletsContainer = element.querySelector('.achievements, ul.achievements');
  if (bulletsContainer && data.description) {
    const bullets = data.description.split(/\n|\.(?=\s)/).map(b => b.trim()).filter(b => b.length > 0);
    if (bullets.length > 0) {
      bulletsContainer.innerHTML = '';
      const ownerDoc = element.ownerDocument || document;
      for (const bullet of bullets) {
        const li = ownerDoc.createElement('li');
        li.textContent = bullet.endsWith('.') ? bullet : bullet + '.';
        bulletsContainer.appendChild(li);
      }
    } else {
      bulletsContainer.remove();
    }
  } else if (bulletsContainer && !data.description) {
    bulletsContainer.remove();
  }
}

/**
 * Render languages section
 */
function renderLanguages(doc: Document, data: ResumeData): void {
  const filteredLanguages = (data.languages || []).filter(lang => {
    const name = (lang.language || '').trim();
    if (!name) return false;
    if (name.toLowerCase() === 'language') return false;
    if (isPlaceholderText(name)) return false;
    return true;
  });

  if (!filteredLanguages || filteredLanguages.length === 0) {
    // No language data - remove standalone language section if exists
    const langSection = findSection(doc, ['language']);
    if (langSection) langSection.remove();
    return;
  }
  
  // Try standalone language section first (OliveGreenModern, Template2ColumnTimeline, etc.)
  const langSection = findSection(doc, ['language']);
  if (langSection) {
    const listEl = langSection.querySelector('ul');
    if (listEl) {
      listEl.innerHTML = '';
      const ownerDoc = listEl.ownerDocument || doc;
      for (const lang of filteredLanguages) {
        const li = ownerDoc.createElement('li');
        const prof = (lang.proficiency || '').trim();
        li.textContent = prof ? `${lang.language} – ${prof}` : lang.language;
        listEl.appendChild(li);
      }
      return;
    }
    
    // Handle paragraph-based language items (Template2ColumnTimeline)
    const langItems = langSection.querySelectorAll('p:not(.section-title), .language-item');
    if (langItems.length > 0) {
      // Remove existing items
      langItems.forEach(item => item.remove());
      
      // Add new items
      const ownerDoc = langSection.ownerDocument || doc;
      for (const lang of filteredLanguages) {
        const p = ownerDoc.createElement('p');
        const prof = (lang.proficiency || '').trim();
        p.textContent = prof ? `${lang.language} – ${prof}` : lang.language;
        langSection.appendChild(p);
      }
      return;
    }
  }
  
  // Fallback: Languages inside skills section as a group
  const skillsSection = findSection(doc, ['skill', 'expertise']);
  if (!skillsSection) return;
  
  // Look for languages group
  const groups = skillsSection.querySelectorAll('.skills-group');
  for (const group of Array.from(groups)) {
    const categoryEl = group.querySelector('.skills-category, strong');
    if (categoryEl && /language/i.test(extractText(categoryEl))) {
      const skillsEl = group.querySelector('.skills-list, .skills');
      if (skillsEl) {
        const langText = filteredLanguages
          .map(l => {
            const prof = (l.proficiency || '').trim();
            return prof ? `${l.language} (${prof})` : l.language;
          })
          .join(', ');
        skillsEl.textContent = langText;
      }
      return;
    }
  }
}

/**
 * Render certifications section
 */
function renderCertifications(doc: Document, data: ResumeData): void {
  if (!data.certifications || data.certifications.length === 0) {
    const certsSection = findSection(doc, ['certification', 'certificate']);
    if (certsSection) {
      // Check if this is a combined "Certifications & Awards" section
      const titleEl = certsSection.querySelector('.section-title, h2, h3');
      const titleText = titleEl ? extractText(titleEl).toLowerCase() : '';
      
      // If it's a combined section with awards, just remove the certifications group
      if (titleText.includes('certification') && titleText.includes('award')) {
        const skillsGroups = certsSection.querySelectorAll('.skills-group');
        for (const group of Array.from(skillsGroups)) {
          const categoryEl = group.querySelector('.skills-category');
          if (categoryEl && /certification/i.test(extractText(categoryEl))) {
            group.remove();
          }
        }
      } else {
        // Otherwise remove the entire section
        certsSection.remove();
      }
    }
    return;
  }
  
  const certsSection = findSection(doc, ['certification', 'certificate']);
  if (!certsSection) return;
  
  // Check for skills-group format (KUSE template: Certifications & Awards combined)
  const skillsGroups = certsSection.querySelectorAll('.skills-group');
  let certsGroupFound = false;
  
  for (const group of Array.from(skillsGroups)) {
    const categoryEl = group.querySelector('.skills-category');
    if (categoryEl && /certification/i.test(extractText(categoryEl))) {
      const skillsListEl = group.querySelector('.skills-list');
      if (skillsListEl) {
        const certTexts = data.certifications.map(cert => {
          let text = cert.name;
          if (cert.issuer) text += ` (${cert.issuer})`;
          return text;
        });
        skillsListEl.textContent = certTexts.join(', ');
        certsGroupFound = true;
        break;
      }
    }
  }
  
  // If skills-group format handled, we're done
  if (certsGroupFound) return;
  
  // Handle item-card format (e.g., .certification-item in Colorful blocks)
  const templateItem = certsSection.querySelector('.certification-item, .cert-item, .certificate-item');
  if (templateItem) {
    const allItems = certsSection.querySelectorAll('.certification-item, .cert-item, .certificate-item');
    allItems.forEach(item => {
      if (item !== templateItem) item.remove();
    });
    for (const cert of data.certifications) {
      const itemEl = cloneElement(templateItem);
      const titleEl = itemEl.querySelector('.title, .cert-title, .item-title, h3, h4');
      if (titleEl) titleEl.textContent = cert.name;
      const dateEl = itemEl.querySelector('.date, .date-badge, .item-date');
      if (dateEl) dateEl.textContent = cert.date || '';
      const issuerEl = itemEl.querySelector('.item-subheader, .issuer, .organization, .subtitle');
      if (issuerEl) issuerEl.textContent = cert.issuer || '';
      certsSection.appendChild(itemEl);
    }
    templateItem.remove();
    return;
  }

  // Otherwise, handle list format
  const listEl = certsSection.querySelector('ul');
  if (listEl) {
    listEl.innerHTML = '';
    
    const ownerDoc = listEl.ownerDocument || doc;
    for (const cert of data.certifications) {
      const li = ownerDoc.createElement('li');
      let certText = cert.name;
      if (cert.issuer) certText += ` - ${cert.issuer}`;
      if (cert.date) certText += ` (${cert.date})`;
      li.textContent = certText;
      listEl.appendChild(li);
    }
  }

  // Last resort: create a list if none exists
  if (!listEl) {
    const ownerDoc = certsSection.ownerDocument || doc;
    const ul = ownerDoc.createElement('ul');
    for (const cert of data.certifications) {
      const li = ownerDoc.createElement('li');
      let certText = cert.name;
      if (cert.issuer) certText += ` - ${cert.issuer}`;
      if (cert.date) certText += ` (${cert.date})`;
      li.textContent = certText;
      ul.appendChild(li);
    }
    certsSection.appendChild(ul);
  }
}

/**
 * Render training section
 */
function renderTraining(doc: Document, data: ResumeData): void {
  if (!data.training || data.training.length === 0) {
    const trainingSection = findSection(doc, ['training', 'courses']);
    if (trainingSection) trainingSection.remove();
    return;
  }
  
  const trainingSection = findSection(doc, ['training', 'courses']);
  if (!trainingSection) return;
  
  const listEl = trainingSection.querySelector('ul');
  if (listEl) {
    listEl.innerHTML = '';
    
    const ownerDoc = listEl.ownerDocument || doc;
    for (const training of data.training) {
      const li = ownerDoc.createElement('li');
      let trainingText = training.name;
      if (training.provider) trainingText += ` - ${training.provider}`;
      li.textContent = trainingText;
      listEl.appendChild(li);
    }
  }
}

/**
 * Render volunteering section
 */
function renderVolunteering(doc: Document, data: ResumeData): void {
  if (!data.volunteering || data.volunteering.length === 0) {
    const volunteerSection = findSection(doc, ['volunteering', 'volunteer']);
    if (volunteerSection) {
      volunteerSection.remove();
    }
    return;
  }
  
  const volunteerSection = findSection(doc, ['volunteering', 'volunteer']);
  if (!volunteerSection) return;
  
  const templateItem = volunteerSection.querySelector('.volunteer-item, .experience-item, li');
  if (!templateItem) return;
  
  const parent = templateItem.parentElement;
  if (!parent) return;
  
  // CRITICAL: Clear ALL existing items in the entire section, not just parent
  // This prevents duplication from template structure or previous renders
  const allExistingItems = volunteerSection.querySelectorAll('.volunteer-item, .experience-item, li');
  allExistingItems.forEach(item => {
    // Only remove if it's not our template item (we need that for cloning)
    if (item !== templateItem) {
      item.remove();
    }
  });
  
  // Also clear any duplicate content that might be in the section
  // Remove any standalone "Organization" text or duplicate paragraphs
  const allParagraphs = volunteerSection.querySelectorAll('p');
  const seenParagraphs = new Set<string>();
  for (const p of Array.from(allParagraphs)) {
    const text = p.textContent?.trim() || '';
    if (text === 'Organization' || text === 'organization') {
      p.remove();
    } else if (text) {
      const normalized = text.toLowerCase().replace(/\s+/g, ' ');
      if (seenParagraphs.has(normalized)) {
        p.remove();
      } else {
        seenParagraphs.add(normalized);
      }
    }
  }
  
  // Deduplicate volunteer items before rendering
  const seenKeys = new Set<string>();
  const uniqueVolunteering = data.volunteering.filter(vol => {
    const key = `${vol.role}|${vol.organization}`.toLowerCase().trim();
    if (seenKeys.has(key)) {
      return false; // Skip duplicate
    }
    seenKeys.add(key);
    return true;
  });
  
  // Render each unique volunteer item
  for (const vol of uniqueVolunteering) {
    const itemEl = cloneElement(templateItem);
    
    // CRITICAL: Completely clear ALL content from cloned template item before populating
    // This prevents duplication from template placeholders or existing content
    const allContentElements = itemEl.querySelectorAll('*');
    for (const el of Array.from(allContentElements)) {
      // Clear text content but preserve element structure
      if (el.textContent) {
        el.textContent = '';
      }
      // Clear innerHTML for list containers
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        el.innerHTML = '';
      }
    }
    // Also clear direct text content of the item itself
    if (itemEl.textContent) {
      itemEl.textContent = '';
    }
    
    // Now populate with actual data - find or create elements
    // Set role/title
    let roleEl = itemEl.querySelector('.role, .title, h3, h4, strong, b');
    if (!roleEl) {
      // Create role element if it doesn't exist
      roleEl = doc.createElement('h3');
      roleEl.className = 'title';
      itemEl.insertBefore(roleEl, itemEl.firstChild);
    }
    roleEl.textContent = vol.role;
    
    // Set organization/company
    let orgEl = itemEl.querySelector('.company, .organization, .details');
    if (!orgEl) {
      // Create org element if it doesn't exist
      orgEl = doc.createElement('div');
      orgEl.className = 'company';
      if (roleEl.nextSibling) {
        itemEl.insertBefore(orgEl, roleEl.nextSibling);
      } else {
        itemEl.appendChild(orgEl);
      }
    }
    orgEl.textContent = vol.organization || '';
    
    // Set description if present; otherwise remove empty description/bullet containers
    const descEl = itemEl.querySelector('.description, p:not(.date), ul');
    if (vol.description) {
      let targetEl = descEl;
      if (!targetEl) {
        targetEl = doc.createElement('p');
        targetEl.className = 'description';
        itemEl.appendChild(targetEl);
      }
      
      if (targetEl.tagName === 'UL') {
        targetEl.innerHTML = '';
        const bullets = vol.description.split(/[•·▪▸►‣⁃-]/).map(b => b.trim()).filter(b => b);
        const deduplicatedBullets = deduplicateArray(bullets);
        deduplicatedBullets.forEach(bullet => {
          const li = doc.createElement('li');
          li.textContent = bullet;
          targetEl!.appendChild(li);
        });
      } else {
        (targetEl as HTMLElement).textContent = vol.description;
      }
    } else if (descEl && (descEl.tagName === 'UL' || descEl.classList.contains('description'))) {
      descEl.remove();
    }
    
    parent.appendChild(itemEl);
  }
  
  // Final pass: Remove any duplicate items that might have been created
  // This handles cases where the template structure itself might cause duplication
  const allItems = volunteerSection.querySelectorAll('.volunteer-item, .experience-item, li');
  const seenContent = new Set<string>();
  const itemsToRemove: Element[] = [];
  
  for (const item of Array.from(allItems)) {
    const itemText = item.textContent?.trim() || '';
    if (!itemText) continue;
    
    // Normalize text for comparison
    const normalized = itemText.toLowerCase().replace(/\s+/g, ' ');
    
    // Check if we've seen this content before
    let isDuplicate = false;
    for (const seen of seenContent) {
      // Check if texts are similar (one contains the other or they're very similar)
      if (normalized === seen || 
          (normalized.length > 20 && seen.length > 20 && 
           (normalized.includes(seen) || seen.includes(normalized)))) {
        isDuplicate = true;
        break;
      }
    }
    
    if (isDuplicate) {
      itemsToRemove.push(item);
    } else {
      seenContent.add(normalized);
    }
  }
  
  // Remove duplicates
  itemsToRemove.forEach(item => item.remove());
}

/**
 * Render awards section
 */
function renderAwards(doc: Document, data: ResumeData): void {
  if (!data.awards || data.awards.length === 0) {
    const awardsSection = findSection(doc, ['award', 'honor', 'achievement']);
    if (awardsSection) {
      // Check if this is a combined "Certifications & Awards" section
      const titleEl = awardsSection.querySelector('.section-title, h2, h3');
      const titleText = titleEl ? extractText(titleEl).toLowerCase() : '';
      
      // If it's a combined section with certifications, just remove the awards group
      if (titleText.includes('certification') && titleText.includes('award')) {
        const skillsGroups = awardsSection.querySelectorAll('.skills-group');
        for (const group of Array.from(skillsGroups)) {
          const categoryEl = group.querySelector('.skills-category');
          if (categoryEl && /award/i.test(extractText(categoryEl))) {
            group.remove();
          }
        }
      } else {
        // Otherwise remove the entire section
        awardsSection.remove();
      }
    }
    return;
  }

  const awardsSection = findSection(doc, ['award', 'honor', 'achievement']);
  if (!awardsSection) return;

  // Check for skills-group format (KUSE template: Certifications & Awards combined)
  const skillsGroups = awardsSection.querySelectorAll('.skills-group');
  let awardsGroupFound = false;
  
  for (const group of Array.from(skillsGroups)) {
    const categoryEl = group.querySelector('.skills-category');
    if (categoryEl && /award/i.test(extractText(categoryEl))) {
      const skillsListEl = group.querySelector('.skills-list');
      if (skillsListEl) {
        const awardTexts = data.awards.map(award => {
          let text = award.name;
          if (award.date) text += ` (${award.date})`;
          return text;
        });
        skillsListEl.textContent = awardTexts.join(', ');
        awardsGroupFound = true;
        break;
      }
    }
  }
  
  // If skills-group format handled, we're done
  if (awardsGroupFound) return;

  // Otherwise, handle list format
  const listEl = awardsSection.querySelector('ul');
  if (listEl) {
    listEl.innerHTML = '';

    const ownerDoc = listEl.ownerDocument || doc;
    for (const award of data.awards) {
      const li = ownerDoc.createElement('li');
      let text = award.name;
      if (award.issuer) {
        text += ` - ${award.issuer}`;
      }
      if (award.date) {
        text += ` (${award.date})`;
      }
      li.textContent = text;
      listEl.appendChild(li);
    }
  } else {
    // Fallback: write into paragraphs or create a list
    const titleEl = awardsSection.querySelector('.section-title, h2, h3');
    // Remove existing content except title
    const children = Array.from(awardsSection.children);
    for (const child of children) {
      if (child !== titleEl) child.remove();
    }

    const ownerDoc = awardsSection.ownerDocument || doc;
    const ul = ownerDoc.createElement('ul');
    for (const award of data.awards) {
      const li = ownerDoc.createElement('li');
      let text = award.name;
      if (award.issuer) text += ` - ${award.issuer}`;
      if (award.date) text += ` (${award.date})`;
      li.textContent = text;
      ul.appendChild(li);
    }
    awardsSection.appendChild(ul);
  }
}

/**
 * Render publications section
 */
function renderPublications(doc: Document, data: ResumeData): void {
  if (!data.publications || data.publications.length === 0) {
    const pubSection = findSection(doc, ['publication']);
    if (pubSection) pubSection.remove();
    return;
  }

  const pubSection = findSection(doc, ['publication']);
  if (!pubSection) return;

  const listEl = pubSection.querySelector('ul');
  if (listEl) {
    listEl.innerHTML = '';

    const ownerDoc = listEl.ownerDocument || doc;
    for (const pub of data.publications) {
      const li = ownerDoc.createElement('li');
      let text = pub.title;
      if (pub.publisher) text += ` - ${pub.publisher}`;
      if (pub.date) text += ` (${pub.date})`;
      li.textContent = text;
      listEl.appendChild(li);
    }
  } else {
    // Fallback: create a list
    const titleEl = pubSection.querySelector('.section-title, h2, h3');
    const children = Array.from(pubSection.children);
    for (const child of children) {
      if (child !== titleEl) child.remove();
    }

    const ownerDoc = pubSection.ownerDocument || doc;
    const ul = ownerDoc.createElement('ul');
    for (const pub of data.publications) {
      const li = ownerDoc.createElement('li');
      let text = pub.title;
      if (pub.publisher) text += ` - ${pub.publisher}`;
      if (pub.date) text += ` (${pub.date})`;
      li.textContent = text;
      ul.appendChild(li);
    }
    pubSection.appendChild(ul);
  }
}

/**
 * References that have a real (non-empty, non-placeholder) name. Used to avoid showing dummy/placeholder rows.
 * Excludes template placeholders like "Harumi Kobayashi", "Adeline Palmerston", "Niranjan Devi", etc.
 */
function getEffectiveReferences(data: ResumeData): ReferenceItem[] {
  if (!data.references || data.references.length === 0) return [];
  return data.references.filter(
    ref => (ref.name && ref.name.trim()) !== '' && !isPlaceholderText(ref.name)
  );
}

/**
 * Render references section when reference data exists.
 * Only renders refs with at least a name; no dummy/empty rows. Clones or removes items as needed.
 */
function renderReferences(doc: Document, data: ResumeData): void {
  const refs = getEffectiveReferences(data);
  if (refs.length === 0) return;

  const refSection = findSection(doc, ['reference']);
  if (!refSection) return;

  const container = refSection.querySelector('.references-container, .references-grid');
  if (!container) return;

  let items = Array.from(container.querySelectorAll('.reference-item'));
  const ownerDoc = container.ownerDocument || doc;

  for (let i = 0; i < refs.length; i++) {
    const ref: ReferenceItem = refs[i];
    let item = items[i];
    if (!item && items.length > 0) {
      item = cloneElement(items[items.length - 1]) as Element;
      container.appendChild(item);
      items = Array.from(container.querySelectorAll('.reference-item'));
    }
    if (!item) {
      const div = ownerDoc.createElement('div');
      div.className = 'reference-item';
      const pName = ownerDoc.createElement('p');
      pName.className = 'reference-name';
      const pDetails = ownerDoc.createElement('p');
      div.appendChild(pName);
      div.appendChild(pDetails);
      container.appendChild(div);
      items = Array.from(container.querySelectorAll('.reference-item'));
      item = items[i];
    }
    if (!item) break;

    const nameEl = item.querySelector('.reference-name');
    if (nameEl) nameEl.textContent = ref.name || '';

    const detailsParts: string[] = [];
    if (ref.affiliation) detailsParts.push(ref.affiliation);
    if (ref.phone) detailsParts.push(`Phone: ${ref.phone}`);
    if (ref.email) detailsParts.push(`Email: ${ref.email}`);
    const detailsHtml = detailsParts.join('<br>');

    const paras = item.querySelectorAll('p');
    const detailsEl = Array.from(paras).find(p => !p.classList.contains('reference-name'));
    if (detailsEl) {
      detailsEl.innerHTML = detailsHtml;
    }
  }

  // Remove extra reference-item elements we don't need
  const allItems = Array.from(container.querySelectorAll('.reference-item'));
  for (let i = refs.length; i < allItems.length; i++) {
    allItems[i].remove();
  }
}

/**
 * Helper: Find a section by title keywords
 * Searches .section, <section>, and [class*="section"] (covers left-section, right-section, etc.)
 */
function findSection(doc: Document, keywords: string[]): Element | null {
  const sections = doc.querySelectorAll('.section, section, [class*="section"]');
  
  for (const section of Array.from(sections)) {
    const titleEl = section.querySelector('.section-title, h2, h3');
    if (titleEl) {
      const titleText = extractText(titleEl).toLowerCase();
      if (keywords.some(kw => titleText.includes(kw))) {
        return section;
      }
    }
  }
  
  return null;
}

/**
 * Remove the References section when the resume has no references.
 * Works for any template: finds by .references-container, .references-grid, or section containing .reference-item.
 * Ensures no dummy/placeholder reference data is shown when references are missing.
 */
function removeReferencesSectionIfEmpty(doc: Document, data: ResumeData): void {
  const hasReferences = getEffectiveReferences(data).length > 0;
  if (hasReferences) return;

  const container = doc.querySelector('.references-container, .references-grid');
  if (container) {
    const section = container.closest('.section, section, [class*="section"]') || container.parentElement;
    if (section) section.remove();
    return;
  }
  // Some templates only have .reference-item inside a section (no container class)
  const refItem = doc.querySelector('.reference-item');
  if (refItem) {
    const section = refItem.closest('.section, section, [class*="section"]') || refItem.parentElement;
    if (section) section.remove();
  }
}

/**
 * Remove the Expertise section when the resume has no skills data.
 * Works for any template: finds by .expertise-list or .expertise-item so the block is never shown when empty.
 * Expertise is the same data as Skills (data.skills).
 */
function removeExpertiseSectionIfEmpty(doc: Document, data: ResumeData): void {
  const hasSkills = !!(data.skills && (data.skills.groups?.length || data.skills.items?.length));
  if (hasSkills) return;

  const container = doc.querySelector('.expertise-list, .expertise-container, [class*="expertise-list"]');
  const expertiseItemSection = doc.querySelector('.expertise-item')?.closest('.section, section, [class*="section"]');
  const sectionFromList = container?.closest('.section, section, [class*="section"]');
  const section = sectionFromList || expertiseItemSection;
  if (section) section.remove();
}

/**
 * Remove sections from the DOM that have no corresponding user data.
 * This prevents empty placeholder sections from taking up space after template swap.
 */
function removeEmptySections(doc: Document, data: ResumeData): void {
  removeReferencesSectionIfEmpty(doc, data);
  removeExpertiseSectionIfEmpty(doc, data);

  const sectionChecks: { keywords: string[]; hasData: boolean }[] = [
    { keywords: ['summary', 'about', 'profile', 'objective'], hasData: !!data.summary?.text },
    { keywords: ['experience', 'work', 'employment'], hasData: !!(data.experience && data.experience.length > 0) },
    { keywords: ['education', 'academic'], hasData: !!(data.education && data.education.length > 0) },
    { keywords: ['skill', 'expertise', 'competenc'], hasData: !!(data.skills && (data.skills.groups?.length || data.skills.items?.length)) },
    { keywords: ['project'], hasData: !!(data.projects && data.projects.length > 0) },
    { keywords: ['language'], hasData: !!(data.languages && data.languages.length > 0) },
    { keywords: ['certification', 'certificate'], hasData: !!(data.certifications && data.certifications.length > 0) },
    { keywords: ['training', 'course'], hasData: !!(data.training && data.training.length > 0) },
    { keywords: ['volunteering', 'volunteer'], hasData: !!(data.volunteering && data.volunteering.length > 0) },
    { keywords: ['award', 'honor', 'achievement'], hasData: !!(data.awards && data.awards.length > 0) },
    { keywords: ['publication'], hasData: !!(data.publications && data.publications.length > 0) },
    { keywords: ['reference'], hasData: getEffectiveReferences(data).length > 0 },
    { keywords: ['interest', 'hobbies', 'hobby'], hasData: false }, // Always remove interests/hobbies (not in career profile)
    { keywords: ['membership'], hasData: false }, // No membership in schema — remove template placeholder section
  ];

  // Remove standalone contact sections when no data (undefined = remove)
  const profile = data.profile;
  const hasPhone = hasRealValue(profile?.phone);
  const hasEmail = hasRealValue(profile?.email);
  const hasLocation = hasRealValue(profile?.location);
  const hasWebsite = hasRealValue(profile?.website);
  const hasLinkedin = hasRealValue(profile?.linkedin);
  const hasGithub = hasRealValue(profile?.github);
  const hasAnyContact = hasPhone || hasEmail || hasLocation || hasWebsite || hasLinkedin || hasGithub;
  const standaloneContactChecks: { keywords: string[]; hasData: boolean }[] = [
    { keywords: ['phone'], hasData: hasPhone },
    { keywords: ['email'], hasData: hasEmail },
    { keywords: ['website', 'web', 'portfolio'], hasData: hasWebsite },
    { keywords: ['address', 'location'], hasData: hasLocation },
    { keywords: ['linkedin'], hasData: hasLinkedin },
    { keywords: ['github'], hasData: hasGithub },
  ];
  // Remove whole "Contact" section (heading + content) when there is no contact data to show
  const contactSectionCheck = { keywords: ['contact'], hasData: hasAnyContact };

  const sections = doc.querySelectorAll('.section, section, [class*="section"]');
  
  for (const section of Array.from(sections)) {
    let titleEl = section.querySelector('.section-title, h2, h3');
    let titleText = titleEl ? extractText(titleEl).toLowerCase() : '';
    // Some templates use .section-title-bottom, or title in <p> (e.g. References)
    if (!titleText && section.querySelector('.section-title-bottom')) {
      titleEl = section.querySelector('.section-title-bottom');
      titleText = titleEl ? extractText(titleEl).toLowerCase() : '';
    }
    if (!titleText) {
      titleText = extractText(section).toLowerCase().slice(0, 200);
    }
    
    // Check main section types
    for (const check of sectionChecks) {
      if (check.keywords.some(kw => titleText.includes(kw)) && !check.hasData) {
        section.remove();
        break;
      }
    }
    
    // Check standalone contact sections (Template2ColumnStylishBlocks, etc.)
    // These are short, single-word titles like "PHONE", "EMAIL", "WEBSITE", "ADDRESS"
    // titleText is already lowercased, so exact match with lowercase keywords suffices
    for (const check of standaloneContactChecks) {
      if (check.keywords.some(kw => titleText === kw) && !check.hasData) {
        section.remove();
        break;
      }
    }
    // Remove "Contact" section (e.g. "Contact", "My Contact") when no phone/email/location/website
    if (contactSectionCheck.keywords.some(kw => titleText.includes(kw)) && !contactSectionCheck.hasData) {
      section.remove();
    }
  }
}

/**
 * Remove certification section when it has no list content (e.g. after stripping placeholder text)
 * and the user has no certifications. Avoids showing a "Certification" heading with placeholder or no items.
 */
function removeEmptyCertificationSection(doc: Document, data: ResumeData): void {
  const hasCerts = !!(data.certifications && data.certifications.length > 0);
  if (hasCerts) return;
  const sections = doc.querySelectorAll('.section, section, [class*="section"]');
  for (const section of Array.from(sections)) {
    const titleEl = section.querySelector('.section-title, h2, h3');
    const titleText = titleEl ? extractText(titleEl).toLowerCase() : '';
    if (!/certification|certificate/.test(titleText)) continue;
    const listEl = section.querySelector('ul, ol');
    if (!listEl) {
      section.remove();
      continue;
    }
    const items = listEl.querySelectorAll('li');
    const hasContent = Array.from(items).some(li => (li.textContent || '').trim().length > 0);
    if (!hasContent) section.remove();
  }
}

/**
 * Remove contact items (phone, email, location, website rows) when profile has no data (undefined/empty).
 */
function removeEmptyContactItems(doc: Document, data: ResumeData): void {
  const profile = data.profile;
  if (!profile) return;
  let contactSection: Element | null = null;
  const contactSelectors = ['.contact-info', '.contact', '.header', '.header-info', '.header-right', '.footer'];
  for (const selector of contactSelectors) {
    contactSection = doc.querySelector(selector);
    if (contactSection) break;
  }
  if (!contactSection) {
    const sections = doc.querySelectorAll('.section, section, .left-section, [class*="section"]');
    for (const section of Array.from(sections)) {
      const titleEl = section.querySelector('.section-title, h2, h3');
      if (titleEl && /contact/i.test(extractText(titleEl))) {
        contactSection = section;
        break;
      }
    }
  }
  // Fallback: any section that contains .contact-item (covers all template structures)
  if (!contactSection) {
    const sections = doc.querySelectorAll('.section, section, [class*="section"]');
    for (const section of Array.from(sections)) {
      if (section.querySelector('.contact-item')) {
        contactSection = section;
        break;
      }
    }
  }
  const hasPhone = hasRealValue(profile.phone);
  const hasEmail = hasRealValue(profile.email);
  const hasLocation = hasRealValue(profile.location);
  const hasWebsite = hasRealValue(profile.website);
  const hasLinkedin = hasRealValue(profile.linkedin);
  const hasGithub = hasRealValue(profile.github);
  const contactRowSelector = '.contact-item, .contact-info > div, .contact-info > span';
  const phonePattern = /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const locationPattern = /123\s+anywhere|any\s+city(?:\s*,?\s*st\s*\d{5})?|denver\s*,\s*co/i;
  const githubPlaceholderPattern = /beckyhsiung96|github\.com\/beckyhsiung96/i;

  /** True if element contains the user's LinkedIn (so we must not remove it when stripping placeholders). */
  const containsUserLinkedIn = (el: Element): boolean => {
    if (!hasLinkedin || !profile.linkedin) return false;
    const text = extractText(el);
    const href = el.querySelector('a')?.getAttribute('href') ?? '';
    const linkNorm = profile.linkedin.replace(/^https?:\/\//i, '').trim();
    const textNorm = text.replace(/^https?:\/\//i, '').trim();
    return (
      href.includes('linkedin.com') && (href.includes(linkNorm) || profile.linkedin.includes(href)) ||
      text.includes('linkedin.com') || textNorm.includes(linkNorm) || linkNorm.includes(textNorm)
    );
  };

  if (contactSection) {
    if (!hasPhone) {
      contactSection.querySelectorAll('.contact-phone, .contact-item.contact-phone').forEach(el => el.remove());
      Array.from(contactSection.querySelectorAll(contactRowSelector)).forEach(el => {
        const text = extractText(el).trim();
        if (text && (phonePattern.test(text) || isPlaceholderText(text))) el.remove();
      });
    }
    if (!hasEmail) {
      contactSection.querySelectorAll('.contact-email, .contact-item.contact-email').forEach(el => el.remove());
      Array.from(contactSection.querySelectorAll(contactRowSelector)).forEach(el => {
        const text = extractText(el).trim();
        if (text && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text) && isPlaceholderText(text)) el.remove();
      });
      // Remove any contact row (e.g. <p><strong>Email</strong><br>hello@reallygreatsite.com</p>) that contains only placeholder email
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      contactSection.querySelectorAll('p, div').forEach(el => {
        const text = extractText(el).trim();
        const emails = text.match(emailRegex);
        if (emails && emails.every((email) => isPlaceholderText(email))) el.remove();
      });
    }
    if (!hasLocation) {
      contactSection.querySelectorAll('.contact-location, .contact-item.contact-location').forEach(el => el.remove());
      Array.from(contactSection.querySelectorAll(contactRowSelector)).forEach(el => {
        const text = extractText(el).trim();
        if (text && (locationPattern.test(text) || isPlaceholderText(text))) el.remove();
      });
    }
    if (!hasWebsite) {
      contactSection.querySelectorAll('.contact-web, .contact-item.contact-web').forEach(el => {
        if (containsUserLinkedIn(el)) return;
        el.remove();
      });
    }
    if (!hasGithub) {
      Array.from(contactSection.querySelectorAll(contactRowSelector)).forEach(el => {
        const text = extractText(el).trim();
        if (text && githubPlaceholderPattern.test(text)) el.remove();
      });
      contactSection.querySelectorAll('a[href*="github.com"]').forEach(a => {
        if (githubPlaceholderPattern.test(a.getAttribute('href') || '') || githubPlaceholderPattern.test(extractText(a))) a.closest('span')?.remove() || a.remove();
      });
    }
    // Normalize separators: collapse " | | " to " | ", then strip leading/trailing " | " so
    // only present contact items show and no bars appear when items are missing.
    if (contactSection.innerHTML) {
      let normalized = contactSection.innerHTML.replace(/\s*\|\s*\|\s*/g, ' | ');
      normalized = normalized.replace(/^(\s*\|\s*)+/, '').replace(/(\s*\|\s*)+$/, '');
      if (normalized !== contactSection.innerHTML) contactSection.innerHTML = normalized;
    }
  }

  // When no real email: remove footer items and contact rows that show placeholder email (icon + text)
  if (!hasEmail) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    doc.querySelectorAll('.footer').forEach(footer => {
      footer.querySelectorAll('.footer-item').forEach(item => {
        const text = extractText(item).trim();
        const emails = text.match(emailRegex);
        if (emails && emails.every((e) => isPlaceholderText(e))) item.remove();
      });
      // Hide empty footer (no remaining items) so the bar does not show
      if (!footer.querySelector('.footer-item') && !extractText(footer).trim()) {
        footer.remove();
      }
    });
    Array.from(doc.querySelectorAll('.contact-item')).forEach(el => {
      const text = extractText(el).trim();
      const emails = text.match(emailRegex);
      if (emails && emails.every((e) => isPlaceholderText(e))) el.remove();
    });
  }

  // Remove any contact row that shows "not_provided" — remove field and icon entirely
  const notProvidedPattern = /^not_provided$/i;
  const contactAreas = doc.querySelectorAll('.contact-info, .contact, .header, .header-info, .header-right');
  contactAreas.forEach(container => {
    Array.from(container.querySelectorAll('.contact-item, div, span, p')).forEach(el => {
      const text = extractText(el).trim();
      if (!text || !notProvidedPattern.test(text)) return;
      const row = el.closest('.contact-item') || el.parentElement || el;
      const parent = row.parentElement;
      row.remove();
      if (parent && !extractText(parent).trim() && !parent.classList.contains('contact-info') && !parent.classList.contains('header') && !parent.classList.contains('contact')) {
        parent.remove();
      }
    });
  });

  // Document-level fallback: remove any contact row with phone/location/placeholder when no real data (works for all templates)
  const contactFallbackSelector = '.contact-item, .contact-info > div, .contact-info > span, .contact-info div, .contact-info span, .header div, .header span, .contact div, .contact span';
  Array.from(doc.querySelectorAll(contactFallbackSelector)).forEach(el => {
    const text = extractText(el).trim();
    if (!text) return;
    if (!hasPhone && (phonePattern.test(text) || text === '123-456-7890' || text === '+123-456-7890' || isPlaceholderText(text))) {
      el.remove();
      // Remove parent row if it now has no text (e.g. icon + placeholder phone), but not the main contact container
      const parent = el.parentElement;
      if (parent && !extractText(parent).trim() && !parent.classList.contains('contact-info') && !parent.classList.contains('header') && !parent.classList.contains('contact')) {
        parent.remove();
      }
    } else if (!hasEmail && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text) && isPlaceholderText(text)) el.remove();
    else if (!hasLocation && (locationPattern.test(text) || isPlaceholderText(text))) el.remove();
    else if (!hasGithub && githubPlaceholderPattern.test(text)) el.remove();
    else if (notProvidedPattern.test(text)) {
      el.remove();
      const parent = el.parentElement;
      if (parent && !extractText(parent).trim() && !parent.classList.contains('contact-info') && !parent.classList.contains('header') && !parent.classList.contains('contact')) {
        parent.remove();
      }
    }
  });

  // Final pass: strip leading/trailing " | " from contact section so bars only show between present items
  doc.querySelectorAll('.contact-info, .contact, .header .contact-info').forEach(section => {
    if (section.innerHTML) {
      let normalized = section.innerHTML.replace(/\s*\|\s*\|\s*/g, ' | ');
      normalized = normalized.replace(/^(\s*\|\s*)+/, '').replace(/(\s*\|\s*)+$/, '');
      if (normalized !== section.innerHTML) section.innerHTML = normalized;
    }
  });

  const sections = doc.querySelectorAll('.section, section, [class*="section"]');
  for (const section of Array.from(sections)) {
    const titleEl = section.querySelector('.section-title, h2, h3');
    if (!titleEl) continue;
    const titleText = extractText(titleEl).toLowerCase();
    if (titleText.includes('phone') && !hasPhone) section.remove();
    else if (titleText.includes('email') && !hasEmail) section.remove();
    else if ((titleText.includes('address') || titleText.includes('location')) && !hasLocation) section.remove();
    else if (titleText.includes('website') && !hasWebsite) section.remove();
  }
}

/**
 * Ensure name and role/title are set in the header when we have profile data.
 * Fixes LLM output that left header blank (e.g. Minimalist simple photo).
 */
function ensureHeaderProfile(doc: Document, data: ResumeData): void {
  const profile = data?.profile;
  if (!profile) return;
  const name = profile.name?.trim();
  const title = profile.title?.trim();
  if (name) {
    const nameSelectors = ['.header-left h1', '.header .name', '.name', 'h1', '.profile-name', '.right-header h1', '.name-title h1'];
    for (const sel of nameSelectors) {
      const el = doc.querySelector(sel);
      if (el && !el.classList.contains('section-title') && !el.classList.contains('reference-name')) {
        el.textContent = name;
        break;
      }
    }
  }
  if (title) {
    const titleSelectors = ['.header-left h2', '.header-left .title', '.header .subtitle', '.role', '.job-title', 'h2:not(.section-title)', '.right-header .subtitle'];
    for (const sel of titleSelectors) {
      const el = doc.querySelector(sel);
      if (el && !el.classList.contains('section-title') && !el.classList.contains('item-title')) {
        el.textContent = title;
        break;
      }
    }
  }
}

/**
 * Clean already-rendered resume HTML: remove empty sections (e.g. References when no data)
 * and remove contact rows that have no data (phone, location). Use when loading HTML
 * into the editor so placeholders and empty sections are not shown.
 */
export function cleanResumeHtmlForDisplay(html: string, data: ResumeData): string {
  if (!html) return html;
  try {
    const doc = parseHtmlToDOM(html);
    if (data?.profile) {
      ensureHeaderProfile(doc, data);
      // Re-apply contact rows (and icons) when cleaning existing HTML
      renderProfile(doc, data);
      fixMinimalistSimplePhotoHeader(doc, data);
      removeEmptyResponsibilitiesTitles(doc);
      removeEmptySections(doc, data);
      removeEmptyContactItems(doc, data);
      stripRemainingPlaceholders(doc, data);
    }
    removeEmptyBulletListsFromDocument(doc);
    if (data) {
      removeEmptyCertificationSection(doc, data);
      if (data.certifications?.length) {
        renderCertifications(doc, data);
      }
    }
    return serializeDOMToHtml(doc);
  } catch {
    return html;
  }
}

/**
 * Replace the first profile/header image in resume HTML with the user's photo URL.
 * Use when writing streamed or generated HTML to the iframe so the placeholder image is updated.
 */
export function injectProfilePhotoIntoHtml(html: string, photoUrl: string): string {
  if (!html || !photoUrl?.trim()) return html;
  try {
    const doc = parseHtmlToDOM(html);
    const photoSelectors = [
      '.profile-pic',
      '.profile-photo',
      '.headshot',
      '.profile-pic-container img',
      '.image-container img:not(.icon)',
      'img[class*="profile"]',
      'img[class*="photo"]',
      '.header img',
      '.header-right img',
    ];
    for (const selector of photoSelectors) {
      const img = doc.querySelector(selector);
      if (img?.tagName === 'IMG' && !img.classList.contains('icon')) {
        img.setAttribute('src', photoUrl.trim());
        return serializeDOMToHtml(doc);
      }
    }
    return html;
  } catch {
    return html;
  }
}

/**
 * Remove any remaining placeholder / Lorem ipsum content from the document.
 * This is a safety net: after all rendering and section removal, any leftover
 * placeholder text that wasn't replaced by real data gets stripped.
 * Uses the comprehensive isPlaceholderText() utility from placeholder-filter.
 *
 * Strategy:
 *  1. Walk every TEXT NODE and blank it if it's placeholder text. This avoids
 *     destroying child elements (SVG icons, <br> tags, etc.)
 *  2. Remove link elements that still point to placeholder URLs.
 *  3. Clean up fully-emptied parent elements.
 */
function stripRemainingPlaceholders(doc: Document, data: ResumeData): void {
  // Never strip the current profile name (e.g. "Becky Shu" is a template placeholder
  // but may also be the user's real name — only strip if it's not the actual profile name).
  const profileName = data.profile?.name?.trim();
  const isCurrentUserName = (text: string) =>
    profileName && text.trim().replace(/\s+/g, ' ') === profileName.replace(/\s+/g, ' ');

  // ---------- Phase 1: Walk ALL text nodes and blank placeholder text ----------
  const body = doc.body || doc.documentElement;
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */, null);
  const textNodesToBlank: Node[] = [];

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || '').trim();
    if (!text) continue;

    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.tagName === 'STYLE' || parent.tagName === 'SCRIPT') continue;

    if (isCurrentUserName(text)) continue;

    if (isPlaceholderText(text)) {
      textNodesToBlank.push(node);
    }
  }

  for (const textNode of textNodesToBlank) {
    textNode.nodeValue = '';
  }

  // ---------- Phase 2: Check element-level text for multi-node placeholders ----------
  // Some placeholders span multiple text nodes (e.g. "Lorem ipsum <br> dolor sit amet")
  // Check the extracted text of each content element as a whole.
  //
  // IMPORTANT: We intentionally do NOT include generic `div` here because large
  // container divs (.right-column, .main-content, etc.) would aggregate ALL nested
  // text. A single leftover placeholder word in a child would cause clearTextNodes()
  // to wipe the ENTIRE container, blanking real data. Only target leaf-level or
  // known content-bearing elements.
  const contentElements = doc.querySelectorAll(
    'p, li, span, td, th, a, ' +
    '.item-description, .about-me-text, .summary, .details, .job-details, ' +
    '.description, .reference-item, .reference-name, .contact-item, .footer-item'
  );
  for (const el of Array.from(contentElements)) {
    // Skip section titles — we don't want to blank headings like "Experience"
    if ((el as HTMLElement).classList?.contains('section-title')) continue;

    // Skip large layout containers — only process leaf or near-leaf content elements.
    // If an element has more than 3 child elements, it's likely a container, not a
    // content block. Clearing it would wipe too much.
    if (el.children.length > 3) continue;

    const text = extractText(el);
    if (!text) continue;

    if (isCurrentUserName(text)) continue;

    if (isPlaceholderText(text)) {
      clearTextNodes(el);
    }
  }

  // ---------- Phase 3: Remove placeholder links ----------
  const placeholderLinks = doc.querySelectorAll(
    'a[href*="example.com"], a[href*="reallygreatsite.com"], a[href*="interestingsite.com"]'
  );
  for (const link of Array.from(placeholderLinks)) {
    link.remove();
  }
  
  // Also remove links with placeholder href patterns
  const allLinks = doc.querySelectorAll('a[href]');
  for (const link of Array.from(allLinks)) {
    const href = link.getAttribute('href') || '';
    if (/reallygreatsite|interestingsite|example\.com/i.test(href)) {
      link.remove();
    }
  }
}

/**
 * Clear all text nodes inside an element without destroying child elements.
 * This preserves SVG icons, <br> tags, etc. while removing visible text.
 */
function clearTextNodes(element: Element): void {
  const walker = element.ownerDocument.createTreeWalker(
    element, 4 /* NodeFilter.SHOW_TEXT */, null
  );
  const nodes: Node[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    nodes.push(n);
  }
  for (const textNode of nodes) {
    textNode.nodeValue = '';
  }
}

/**
 * Embed ResumeData as JSON in the HTML document
 * This allows the editor to access the structured data later for re-populating sections
 */
function embedResumeData(doc: Document, data: ResumeData): void {
  const head = doc.querySelector('head');
  const body = doc.querySelector('body');
  
  if (!head && !body) return;
  
  // Create a script tag with the resume data
  const scriptEl = doc.createElement('script');
  scriptEl.type = 'application/json';
  scriptEl.id = 'resume-data';
  
  // Sanitize data to avoid XSS (remove any script tags from description fields)
  const sanitizedData = JSON.stringify(data, (key, value) => {
    if (typeof value === 'string') {
      // Remove any <script> tags
      return value.replace(/<script[^>]*>.*?<\/script>/gi, '');
    }
    return value;
  });
  
  scriptEl.textContent = sanitizedData;
  
  // Append to head if available, otherwise to body
  if (head) {
    head.appendChild(scriptEl);
  } else if (body) {
    body.appendChild(scriptEl);
  }
}

/**
 * Fix CSS in the rendered HTML to ensure continuous content flow.
 * Converts fixed heights to min-heights and removes overflow:hidden on .page containers.
 * Carefully avoids breaking flex-grow based layouts (e.g. ColorfulBlocks).
 */
function fixContinuousLayoutCSS(doc: Document, template: ResumeTemplate): void {
  const pageSize = template.pageSize || 'A4';
  const pageHeight = pageSize === 'Letter' ? '1056px' : '1123px';
  const pageSizeCss = pageSize === 'Letter' ? 'letter' : 'A4';

  // Inject CSS overrides into a new <style> block
  const styleEl = doc.createElement('style');
  styleEl.textContent = `
    /* Print: consistent margins on every page so content isn't cut off or stuck to edges */
    @page {
      size: ${pageSizeCss};
      margin: 12mm;
    }
    @media print {
      body { padding: 0 !important; }
    }
    /* Continuous content layout fix - prevents blank pages and content clipping */
    .page {
      height: auto !important;
      min-height: ${pageHeight};
      overflow: visible !important;
    }
    .main-container {
      height: auto !important;
      min-height: 100%;
    }
    /* Only override .main-content height if it uses fixed/calc height, not flex-grow */
    .main-content[style*="height"] {
      height: auto !important;
      min-height: auto;
    }
    /* Prevent profile images from stretching to fill flex containers */
    .profile-pic-container img {
      height: auto !important;
      max-height: 350px;
    }

    /*
     * Fix absolutely-positioned footers inside flex containers.
     * Templates like OliveGreenModern use position:absolute on .footer
     * which causes blank space when content exceeds one page because
     * the footer sits at the bottom of the expanded .page, leaving
     * a gap on page 1.
     * Fix: convert the footer to normal document flow so it sits
     * right after the content, and let it wrap in the flex container.
     *
     * NOTE: flex-wrap is applied via inline style ONLY to .main-content
     * elements that contain a .footer child (see JS below). Applying it
     * globally via CSS breaks two-column layouts like ColorfulBlocks.
     */
    .page > .main-content > .footer,
    .page .footer[style*="position: absolute"],
    .footer {
      position: relative !important;
      bottom: auto !important;
      right: auto !important;
      left: auto !important;
      width: 100% !important;
      flex-basis: 100% !important;
      margin-top: 30px;
    }
    /* Ensure .page has bottom padding so footer content isn't clipped */
    .page {
      padding-bottom: 0 !important;
    }

    @media print {
      .page {
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
      }
    }
  `;
  styleEl.id = 'resume-layout-fix';
  const head = doc.querySelector('head');
  if (head) {
    head.appendChild(styleEl);
  } else {
    // If no head, prepend to body
    const body = doc.querySelector('body');
    if (body) {
      body.insertBefore(styleEl, body.firstChild);
    }
  }

  // Global no-cutoff layer: prevents text clipping at page end/start in any template.
  // Applied to body and all common wrappers so long content is never clipped.
  const noCutoffEl = doc.createElement('style');
  noCutoffEl.id = 'resume-no-cutoff-layer';
  noCutoffEl.textContent = `
    /* No-cutoff: ensure no container clips content at page boundaries (screen + print) */
    body,
    .resume-container,
    .main-container,
    .main-content,
    .page,
    .content,
    main,
    [class*="resume"],
    [class*="main"] {
      overflow: visible !important;
    }
    /* Allow text to break across pages; avoid single line stranded at top/bottom */
    p, li, .summary, .job-description, .item-description, .experience-item .content,
    .education-item .content, [class*="description"], [class*="summary"] {
      orphans: 2;
      widows: 2;
    }
    @media print {
      body,
      .resume-container,
      .main-container,
      .main-content,
      .page,
      .content,
      main,
      html {
        overflow: visible !important;
      }
    }
  `;
  if (head) {
    head.appendChild(noCutoffEl);
  } else {
    const bodyEl = doc.querySelector('body');
    if (bodyEl) {
      bodyEl.insertBefore(noCutoffEl, bodyEl.firstChild);
    }
  }
  
  // Add template-specific fixes for AccentColorMinimal
  // Note: Spacing is handled by LLM prompts, only essential rendering fixes here
  if (template.id === 'accentcolorminimal') {
    const accentStyleEl = doc.createElement('style');
    accentStyleEl.textContent = `
      /* AccentColorMinimal essential rendering fixes only */
      .page {
        height: auto !important;
        min-height: 1123px !important;
        overflow: visible !important;
      }
      .main-content {
        display: flex !important;
        flex-direction: column !important;
      }
    `;
    if (head) {
      head.appendChild(accentStyleEl);
    } else {
      const body = doc.querySelector('body');
      if (body) {
        body.insertBefore(accentStyleEl, body.firstChild);
      }
    }
  }
  
  // Apply flex-wrap ONLY to .main-content elements that contain a .footer child.
  // This allows the footer to wrap to a new line while columns stay side-by-side
  // (column widths must properly account for any gap so they sum to ≤ 100%).
  const mainContents = doc.querySelectorAll('.main-content');
  for (const mc of Array.from(mainContents)) {
    if (mc.querySelector('.footer')) {
      (mc as HTMLElement).style.flexWrap = 'wrap';
    }
  }
}

/**
 * Final string-level cleanup for placeholder text in serialized HTML.
 * Only touches text content between HTML tags (not attributes, class names, etc.).
 * This is the absolute last safety net.
 */
function stripPlaceholderStrings(html: string): string {
  // Patterns that indicate placeholder text content (only match inside HTML text nodes)
  // We use a callback replacer that only blanks the text between > and <
  const PLACEHOLDER_CONTENT_PATTERNS: RegExp[] = [
    // Lorem ipsum and related filler
    /lorem\s+ipsum[^<]*/gi,
    /dolor\s+sit\s+amet[^<]*/gi,
    /consectetur\s+adipiscing[^<]*/gi,
    /nullam\s+pharetra[^<]*/gi,
    /nunc\s+sit\s+amet\s+sem[^<]*/gi,
    /donec\s+hendrerit[^<]*/gi,
    /donec\s+risus\s+arcu[^<]*/gi,
    /vel\s+tempus\s+metus[^<]*/gi,
    /in\s+elementum\s+elit[^<]*/gi,
    /in\s+enim\s+nunc[^<]*/gi,
    /luctus\s+sollicitudin[^<]*/gi,
    /sed\s+leo\s+nisl[^<]*/gi,
  ];
  
  // Only replace text content (between > and <), not inside tags or attributes
  for (const pattern of PLACEHOLDER_CONTENT_PATTERNS) {
    html = html.replace(
      new RegExp(`(>\\s*)${pattern.source}(\\s*<)`, pattern.flags.includes('i') ? 'gi' : 'g'),
      '$1$2'
    );
  }
  
  return html;
}
