/**
 * Profile Adapter
 * 
 * Converts CareerProfile to ResumeData schema for deterministic rendering.
 * This allows fallback to template rendering when AI generation fails.
 */

import { CareerProfile, CareerProfileItem } from '@/types/career';
import { ResumeData, ExperienceItem, EducationItem, ProjectItem, SkillsSection, LanguageItem, CertificationItem, AwardItem, PublicationItem } from './schema';

/**
 * Extract display name from analysisReport when personal.name is missing.
 * Handles patterns like "Analysis of PDF: BECKY SHU_Product Manager..." or "### Analysis...: NAME_".
 */
function extractNameFromAnalysisReport(analysisReport: string): string {
  if (!analysisReport?.trim()) return '';
  // Primary: "Analysis of PDF: NAME_Role..." or "### Analysis of PDF: NAME_..."
  const m = analysisReport.match(/(?:Analysis of PDF|###\s*Analysis[^:]*):\s*([A-Za-z0-9\s'-]+?)(?:_|-\s|\s+[A-Z]|\r?\n|\.|$)/i);
  if (m?.[1]) {
    const name = m[1].trim().replace(/\s+/g, ' ');
    if (name.length >= 2 && name.length <= 80) return name;
  }
  // Fallback: first line containing "Analysis of PDF:", name is text after colon until _ or " - "
  const line = analysisReport.split(/\r?\n/).find((l) => /Analysis of PDF/i.test(l));
  if (line) {
    const afterColon = line.replace(/^.*:\s*/, '').trim();
    const name = (afterColon.split(/_\s*|-\s+/)[0]?.trim() ?? '').replace(/\s+/g, ' ');
    if (name.length >= 2 && name.length <= 80) return name;
  }
  return '';
}

/**
 * Convert CareerProfile to ResumeData
 */
export function careerProfileToResumeData(profile: CareerProfile): ResumeData {
  // Extract items by category
  const roleItems = profile.items.filter(item => item.category === 'role');
  const projectItems = profile.items.filter(item => item.category === 'project');
  const educationItems = profile.items.filter(item => item.category === 'education');
  const skillItems = profile.items.filter(item => item.category === 'skill');
  const certItems = profile.items.filter(item => item.category === 'certification');
  const languageItems = profile.items.filter(item => item.category === 'language');
  const volunteerItems = profile.items.filter(item => item.category === 'volunteer');
  const awardItems = profile.items.filter(item => item.category === 'award');
  const publicationItems = profile.items.filter(item => item.category === 'publication');

  const profileName =
    profile.personal?.name?.trim() ||
    extractNameFromAnalysisReport(profile.analysisReport || '');

  const firstRoleTitle = roleItems.length > 0 ? roleItems[0].title?.trim() : undefined;

  // Build ResumeData
  const resumeData: ResumeData = {
    profile: {
      name: profileName,
      title: firstRoleTitle,
      location: profile.personal?.location,
      email: profile.contact?.email,
      phone: profile.contact?.phone,
      linkedin: profile.contact?.linkedin,
      github: profile.contact?.github,
      website: profile.contact?.website,
      photo: profile.personal?.photos?.[0],
    },
    summary: profile.summary ? { text: profile.summary } : undefined,
    experience: roleItems.length > 0 ? roleItems.map(convertToExperience) : undefined,
    education: educationItems.length > 0 ? educationItems.map(convertToEducation) : undefined,
    skills: convertToSkills(skillItems),
    projects: projectItems.length > 0 ? projectItems.map(convertToProject) : undefined,
    languages: languageItems.length > 0 ? languageItems.map(convertToLanguage) : undefined,
    certifications: certItems.length > 0 ? certItems.map(convertToCertification) : undefined,
    volunteering: volunteerItems.length > 0 ? volunteerItems.map(convertToVolunteering) : undefined,
    awards: awardItems.length > 0 ? awardItems.map(convertToAward) : undefined,
    publications: publicationItems.length > 0 ? publicationItems.map(convertToPublication) : undefined,
    references:
      profile.references && profile.references.length > 0
        ? profile.references.map((ref, i) => ({
            id: `ref-${i}`,
            name: ref.name || '',
            affiliation: ref.affiliation,
            phone: ref.phone,
            email: ref.email,
          }))
        : undefined,
  };

  return resumeData;
}

/**
 * Split description into discrete bullets. Handles newlines, pipe (|), and bullet chars
 * so LinkedIn/ingestion content like "Point A | Point B" or concatenated text becomes proper list items.
 */
function parseDescriptionToBullets(description: string): string[] {
  if (!description?.trim()) return [];
  const raw = description
    .split(/\n/)
    .flatMap((line) => line.split(/\|/))
    .flatMap((part) => part.split(/[•·▪▸►‣⁃]\s*/))
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  return raw.length > 0 ? raw : [description.trim()];
}

/**
 * Convert CareerProfileItem (role) to ExperienceItem
 */
function convertToExperience(item: CareerProfileItem): ExperienceItem {
  const bullets = parseDescriptionToBullets(item.description || '');

  // Parse dates (format: "Jan 2020 - Dec 2022" or "2020 - 2022")
  let startDate = '';
  let endDate = '';
  if (item.dates) {
    const dateParts = item.dates.split(/\s*[-–—]\s*/);
    if (dateParts.length >= 2) {
      startDate = dateParts[0].trim();
      endDate = dateParts[1].trim();
    } else {
      startDate = item.dates;
    }
  }

  return {
    id: item.id,
    title: item.title,
    company: item.organization || '',
    location: '', // Not in CareerProfileItem
    startDate,
    endDate,
    bullets,
  };
}

/**
 * Convert CareerProfileItem (education) to EducationItem
 */
function convertToEducation(item: CareerProfileItem): EducationItem {
  // Parse dates
  let startDate = '';
  let endDate = '';
  if (item.dates) {
    const dateParts = item.dates.split(/\s*[-–—]\s*/);
    if (dateParts.length >= 2) {
      startDate = dateParts[0].trim();
      endDate = dateParts[1].trim();
    } else {
      endDate = item.dates; // Graduation date
    }
  }

  return {
    id: item.id,
    degree: item.title,
    school: item.organization || '',
    location: '', // Not in CareerProfileItem
    startDate,
    endDate,
  };
}

/**
 * Convert CareerProfileItem (project) to ProjectItem
 */
function convertToProject(item: CareerProfileItem): ProjectItem {
  // Parse dates (format: "Jan 2020 - Dec 2022" or "2020 - 2022")
  let startDate = '';
  let endDate = '';
  if (item.dates) {
    const dateParts = item.dates.split(/\s*[-–—]\s*/);
    if (dateParts.length >= 2) {
      startDate = dateParts[0].trim();
      endDate = dateParts[1].trim();
    } else {
      startDate = item.dates;
    }
  }

  return {
    id: item.id,
    title: item.title,
    organization: item.organization,
    description: item.description,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };
}

/**
 * Convert skill items to SkillsSection
 * Supports both flat lists and grouped skills
 */
function convertToSkills(skillItems: CareerProfileItem[]): SkillsSection | undefined {
  if (skillItems.length === 0) return undefined;

  // Check if skills have categories (in organization field)
  const skillsWithCategories = skillItems.filter(item => item.organization && item.organization.trim());
  
  if (skillsWithCategories.length > 0) {
    // Group skills by category
    const grouped: { [category: string]: string[] } = {};
    
    skillItems.forEach(item => {
      const category = item.organization?.trim() || 'Other';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(item.title);
    });
    
    const groups = Object.entries(grouped).map(([category, skills]) => ({
      category,
      skills
    }));
    
    return { groups };
  }
  
  // Fallback to flat list
  const skills = skillItems.map(item => item.title);
  return { items: skills };
}

/**
 * Convert CareerProfileItem (language) to LanguageItem
 */
function convertToLanguage(item: CareerProfileItem): LanguageItem {
  // Try to extract proficiency from description or title
  const proficiency = item.description || 'Proficient';
  
  return {
    id: item.id,
    language: item.title,
    proficiency,
  };
}

/**
 * Convert CareerProfileItem (certification) to CertificationItem
 */
function convertToCertification(item: CareerProfileItem): CertificationItem {
  return {
    id: item.id,
    name: item.title,
    issuer: item.organization || '',
    date: item.dates,
  };
}

/**
 * Convert CareerProfileItem (volunteer) to VolunteeringItem
 */
function convertToVolunteering(item: CareerProfileItem) {
  // Parse dates
  let startDate = '';
  let endDate = '';
  if (item.dates) {
    const dateParts = item.dates.split(/\s*[-–—]\s*/);
    if (dateParts.length >= 2) {
      startDate = dateParts[0].trim();
      endDate = dateParts[1].trim();
    } else {
      startDate = item.dates;
    }
  }

  return {
    id: item.id,
    role: item.title,
    organization: item.organization || '',
    startDate,
    endDate,
    description: item.description,
  };
}

/**
 * Convert CareerProfileItem (award) to AwardItem
 */
function convertToAward(item: CareerProfileItem): AwardItem {
  return {
    id: item.id,
    name: item.title,
    issuer: item.organization || '',
    date: item.dates,
    description: item.description || '',
  };
}

/**
 * Convert CareerProfileItem (publication) to PublicationItem
 */
function convertToPublication(item: CareerProfileItem): PublicationItem {
  return {
    id: item.id,
    title: item.title,
    publisher: item.organization || '',
    date: item.dates,
    description: item.description || '',
  };
}

// --- localStorage helpers for resume data persistence ---

const CAREER_PROFILE_RESUME_DATA_KEY = 'career_profile_resume_data';
const RESUME_EDITS_DATA_KEY = 'resume_edits_data';

/**
 * Store the career profile as ResumeData in localStorage.
 * Called when user clicks "Generate" in ProfileReview.
 */
export function saveCareerProfileResumeData(profile: CareerProfile): void {
  try {
    const resumeData = careerProfileToResumeData(profile);
    localStorage.setItem(CAREER_PROFILE_RESUME_DATA_KEY, JSON.stringify(resumeData));
  } catch (e) {
    console.error('[saveCareerProfileResumeData] Failed to save:', e);
  }
}

/**
 * Load the stored career profile ResumeData from localStorage.
 * Used by SectionManager to populate sections with actual data.
 */
export function loadCareerProfileResumeData(): ResumeData | null {
  try {
    const stored = localStorage.getItem(CAREER_PROFILE_RESUME_DATA_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as ResumeData;
  } catch (e) {
    console.error('[loadCareerProfileResumeData] Failed to load:', e);
    return null;
  }
}

/**
 * Clear stored career profile ResumeData from localStorage.
 */
export function clearCareerProfileResumeData(): void {
  try {
    localStorage.removeItem(CAREER_PROFILE_RESUME_DATA_KEY);
  } catch (e) {
    // ignore
  }
}

/**
 * Save the latest resume edits data to localStorage.
 * Called after each template switch or AI modification to
 * accumulate edits so they survive across template switches.
 */
export function saveResumeEditsData(data: ResumeData): void {
  try {
    localStorage.setItem(RESUME_EDITS_DATA_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[saveResumeEditsData] Failed to save:', e);
  }
}

/**
 * Load the latest resume edits data from localStorage.
 * This is the accumulated edits data from prior template switches/edits.
 */
export function loadResumeEditsData(): ResumeData | null {
  try {
    const stored = localStorage.getItem(RESUME_EDITS_DATA_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as ResumeData;
  } catch (e) {
    console.error('[loadResumeEditsData] Failed to load:', e);
    return null;
  }
}

/**
 * Clear stored resume edits data from localStorage.
 */
export function clearResumeEditsData(): void {
  try {
    localStorage.removeItem(RESUME_EDITS_DATA_KEY);
  } catch (e) {
    // ignore
  }
}