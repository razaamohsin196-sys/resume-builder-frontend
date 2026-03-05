import { ApifyClient } from 'apify-client';
import { IngestionAgent, IngestionSource, CareerProfilePatch, ChatLearning } from '../types';
import { CareerIntent } from '@/types/career';
import { generateContent } from '@/lib/ai/provider';

const SYSTEM_PROMPT = `
You are LinkedInIngestionAgent.

GOAL
Extract ALL career signals from the LinkedIn profile JSON and output a structured PATCH. You MUST include EVERY role, education, certification, skill, volunteering, and award entry. Do NOT skip, summarize, or omit any entry. Preserve exact dates (startDate, endDate) for each item as they appear in the data.

CRITICAL RULES
- Extract EVERY experience/role, EVERY education entry, EVERY certification, EVERY skill, EVERY volunteering and award. If the JSON has 10 roles, output 10 roles with full details and dates.
- Preserve exact date strings from the source: startDate and endDate for roles, education, volunteering. Use the format present in the data (e.g. "2020", "Jan 2020", "2020 - 2023").
- For each role: include title, company, description (full), startDate, endDate. Use "Present" or "Current" for current roles if endDate is missing.

STABLE ID RULES
- Role: "linkedin:role:<company_clean>:<title_clean>"
- Skill: "skill:<normalized_name>"
- Project: "linkedin:project:<name>"
- Education: "linkedin:edu:<school_clean>:<degree_clean>"
- Volunteer: "linkedin:vol:<org_clean>:<role_clean>"
- Certification: "linkedin:cert:<name_clean>"
- Award: "linkedin:award:<title_clean>"

PROJECT TITLES
- NEVER use "Project Name", "Untitled", or "New Project" as a title.
- If a project lacks a clear title, INFER a descriptive 2-4 word title from the description (e.g. "Hokuyo Sensor Simulation").

OUTPUT FORMAT (JSON)
{
  "chat_learnings": { "sourceType": "LinkedIn", "title": "LinkedIn Analysis", "sections": [{"heading": "Key Strengths", "bullets": ["..."]}] },
  "career_profile_patch": {
      "sourceId": "linkedin:profile",
      "upsert_roles": [
          {
              "id": "linkedin:role:company:title",
              "title": { "value": "Title" },
              "company": { "value": "Company" },
              "description": { "value": "..." },
              "startDate": { "value": "..." },
              "endDate": { "value": "..." }
          }
      ],
      "upsert_skills": [
          { "id": "skill:java", "name": "Java", "category": "Language" }
      ],
      "upsert_education": [
          {
              "id": "linkedin:edu:ubc:bcs",
              "school": { "value": "UBC" },
              "degree": { "value": "Bachelor of Computer Science" },
              "startDate": { "value": "2016" },
              "endDate": { "value": "2020" }
          }
      ],
      "upsert_volunteering": [
          {
              "id": "linkedin:vol:spca:walker",
              "role": { "value": "Dog Walker" },
              "organization": { "value": "SPCA" },
              "description": { "value": "..." },
              "startDate": { "value": "..." },
              "endDate": { "value": "..." }
          }
      ],
      "upsert_certifications": [
          {
              "id": "linkedin:cert:aws-sa",
              "name": { "value": "AWS Solutions Architect" },
              "authority": { "value": "Amazon Web Services" },
              "date": { "value": "Issued Dec 2023" }
          }
      ],
      "upsert_awards": [
          {
              "id": "linkedin:award:employee-month",
              "title": { "value": "Employee of the Month" },
              "issuer": { "value": "Company Inc" },
              "date": { "value": "2022" }
          }
      ],
      "upsert_languages": [{ "id": "lang:mandarin", "name": "Mandarin", "category": "Language" }],
      "personal": { "name": "John Doe", "location": "Seattle, WA" },
      "contact": { "linkedin": "https://linkedin.com/in/johndoe", "email": "john@example.com" },
      "professionalSummaryDraft": { "value": "..." }
  }
}
`;

/** Normalize a string for use in stable IDs (lowercase, alphanumeric + hyphen) */
function slug(s: string, maxLen = 40): string {
    if (!s || typeof s !== 'string') return 'unknown';
    return s
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .toLowerCase()
        .slice(0, maxLen) || 'unknown';
}

/** Extract a single date string from LinkedIn format (can be string or { month, year }) */
function toDateString(v: any): string {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object' && (v.month != null || v.year != null)) {
        const m = v.month != null ? String(v.month).slice(0, 3) : '';
        const y = v.year != null ? String(v.year) : '';
        return [m, y].filter(Boolean).join(' ');
    }
    return '';
}

/**
 * Build a CareerProfilePatch directly from raw LinkedIn/Apify profile JSON.
 * Used when AI fails or returns sparse data so we never lose profile data.
 */
function rawLinkedInToPatch(profile: Record<string, any>, sourceId: string): CareerProfilePatch {
    const patch: CareerProfilePatch = { sourceId };

    const experiences = profile.experience || profile.experiences || profile.positions || profile.workExperience || [];
    const educationList = profile.education || profile.schools || [];
    const skillsList = profile.skills || [];
    const certs = profile.certifications || [];
    const volunteeringList = profile.volunteering || profile.volunteer || [];
    const awardsList = profile.honorsAndAwards || profile.awards || [];
    const languagesList = profile.languages || [];
    const projectsList = profile.projects || [];

    if (experiences.length > 0) {
        patch.upsert_roles = experiences.map((exp: any, i: number) => {
            const company = exp.companyName || exp.company || exp.organization || '';
            const title = exp.title || exp.position || 'Role';
            const id = `linkedin:role:${slug(company)}:${slug(title)}-${i}`;
            const startDate = toDateString(exp.startDate);
            const endDate = toDateString(exp.endDate) || (exp.current ? 'Present' : '');
            const desc = exp.description || exp.summary || '';
            return {
                id,
                title: { value: title },
                company: { value: company },
                description: { value: desc },
                ...(startDate && { startDate: { value: startDate } }),
                ...(endDate && { endDate: { value: endDate } }),
                ...(exp.location && { location: { value: exp.location } }),
            };
        });
    }

    if (educationList.length > 0) {
        patch.upsert_education = educationList.map((edu: any, i: number) => {
            const school = edu.schoolName || edu.school || edu.institution || '';
            const degree = edu.degreeName || edu.degree || edu.fieldOfStudy || 'Degree';
            const id = `linkedin:edu:${slug(school)}:${slug(degree)}-${i}`;
            const startDate = toDateString(edu.startDate);
            const endDate = toDateString(edu.endDate);
            return {
                id,
                school: { value: school },
                degree: { value: degree },
                ...(edu.fieldOfStudy && degree !== edu.fieldOfStudy && { fieldOfStudy: { value: edu.fieldOfStudy } }),
                ...(startDate && { startDate: { value: startDate } }),
                ...(endDate && { endDate: { value: endDate } }),
                ...(edu.description && { description: { value: edu.description } }),
            };
        });
    }

    if (skillsList.length > 0) {
        patch.upsert_skills = skillsList.map((s: any) => {
            const name = typeof s === 'string' ? s : (s.name || s.skillName || '');
            if (!name) return null;
            return { id: `skill:${slug(name)}`, name, category: typeof s === 'object' ? (s.category || s.endorsementCount ? 'Skill' : 'Skill') : 'Skill' };
        }).filter(Boolean) as any;
    }

    if (certs.length > 0) {
        patch.upsert_certifications = certs.map((c: any, i: number) => {
            const name = c.name || c.title || 'Certification';
            const authority = c.authority || c.issuer || c.organization || '';
            return {
                id: `linkedin:cert:${slug(name)}-${i}`,
                name: { value: name },
                authority: { value: authority },
                ...(c.date && { date: { value: toDateString(c.date) || String(c.date) } }),
                ...(c.url && { url: { value: c.url } }),
            };
        });
    }

    if (volunteeringList.length > 0) {
        patch.upsert_volunteering = volunteeringList.map((v: any, i: number) => {
            const org = v.organization || v.companyName || v.company || '';
            const role = v.role || v.title || 'Volunteer';
            const id = `linkedin:vol:${slug(org)}:${slug(role)}-${i}`;
            const startDate = toDateString(v.startDate);
            const endDate = toDateString(v.endDate);
            return {
                id,
                role: { value: role },
                organization: { value: org },
                description: v.description ? { value: v.description } : undefined,
                ...(startDate && { startDate: { value: startDate } }),
                ...(endDate && { endDate: { value: endDate } }),
            };
        });
    }

    if (awardsList.length > 0) {
        patch.upsert_awards = awardsList.map((a: any, i: number) => {
            const title = a.title || a.name || 'Award';
            return {
                id: `linkedin:award:${slug(title)}-${i}`,
                title: { value: title },
                ...(a.issuer && { issuer: { value: a.issuer } }),
                ...(a.date && { date: { value: toDateString(a.date) || String(a.date) } }),
                ...(a.description && { description: { value: a.description } }),
            };
        });
    }

    if (languagesList.length > 0) {
        patch.upsert_languages = languagesList.map((l: any) => {
            const name = typeof l === 'string' ? l : (l.name || l.language || '');
            if (!name) return null;
            return { id: `lang:${slug(name)}`, name, category: 'Language' };
        }).filter(Boolean) as any;
    }

    if (projectsList.length > 0) {
        patch.upsert_projects = projectsList
            .map((p: any) => {
                const name = p.name || p.title || '';
                if (!name || /^(project\s*name|untitled|new project)$/i.test(name.trim())) return null;
                return {
                    id: `linkedin:project:${slug(name)}`,
                    name,
                    ...(p.description && { description: { value: p.description } }),
                    ...(p.url && { url: { value: p.url } }),
                    ...(p.startDate && { startDate: { value: toDateString(p.startDate) } }),
                    ...(p.endDate && { endDate: { value: toDateString(p.endDate) } }),
                };
            })
            .filter(Boolean) as any;
    }

    const fullName = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || '';
    const location = profile.location || profile.geoCountryName || profile.geoLocationName || '';
    if (fullName || location) {
        patch.personal = { name: fullName, location: location || undefined };
    }
    const imageUrl = profile.profilePic || profile.profileImgURL || profile.pictureUrl || profile.photo;
    if (imageUrl && patch.personal) {
        patch.personal.headshot = imageUrl;
    }

    if (profile.contactInfo?.email || profile.publicIdentifier) {
        patch.contact = {
            ...(profile.contactInfo?.email && { email: profile.contactInfo.email }),
            ...(profile.publicIdentifier && { linkedin: `https://linkedin.com/in/${profile.publicIdentifier}` }),
        };
    }

    const summary = profile.summary || profile.about || profile.headline;
    if (summary && typeof summary === 'string') {
        patch.professionalSummaryDraft = { value: summary };
    }

    return patch;
}

/** Merge fallback patch into AI patch: add any roles/education/etc. that AI missed (by ID). */
function mergeFallbackPatch(aiPatch: CareerProfilePatch, fallback: CareerProfilePatch): void {
    const mergeArrays = (key: keyof CareerProfilePatch) => {
        const aiList = ((aiPatch as any)[key] as any[]) || [];
        const fallbackList = ((fallback as any)[key] as any[]) || [];
        if (fallbackList.length === 0) return;
        const aiIds = new Set(aiList.map((x: any) => x.id));
        const added = fallbackList.filter((item: any) => item.id && !aiIds.has(item.id));
        if (added.length > 0) {
            (aiPatch as any)[key] = [...aiList, ...added];
        }
    };
    mergeArrays('upsert_roles');
    mergeArrays('upsert_education');
    mergeArrays('upsert_skills');
    mergeArrays('upsert_certifications');
    mergeArrays('upsert_volunteering');
    mergeArrays('upsert_awards');
    mergeArrays('upsert_languages');
    mergeArrays('upsert_projects');
    if (fallback.personal && !aiPatch.personal?.name && fallback.personal.name) {
        aiPatch.personal = { ...aiPatch.personal, name: fallback.personal.name };
        if (fallback.personal.location) aiPatch.personal.location = fallback.personal.location;
        if (fallback.personal.headshot) aiPatch.personal.headshot = fallback.personal.headshot;
    }
    if (fallback.contact && !aiPatch.contact && fallback.contact) {
        aiPatch.contact = fallback.contact;
    }
    if (fallback.professionalSummaryDraft?.value && !aiPatch.professionalSummaryDraft?.value) {
        aiPatch.professionalSummaryDraft = fallback.professionalSummaryDraft;
    }
}

export const LinkedInIngestionAgent: IngestionAgent = {
    id: 'linkedin-agent',

    accepts: (source: IngestionSource) => {
        return source.type === 'linkedin' && !!source.url && source.url.includes('linkedin.com/');
    },

    process: async (source: IngestionSource, intent: CareerIntent) => {
        // 1. Get Apify Token
        const token = process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
        if (!token) {
            console.warn("No APIFY_API_TOKEN or APIFY_API_KEY found.");
            throw new Error("Missing APIFY_API_KEY");
        }

        const client = new ApifyClient({ token });

        // 2. Fetch/Run Scraper
        let profileData = source.content ? JSON.parse(source.content) : null;
        if (!profileData && source.url) {
            try {
                // HarvestAPI Scraper (LpVuK3Zozwuipa5bp)
                const run = await client.actor("LpVuK3Zozwuipa5bp").call({
                    "profileScraperMode": "Profile details no email ($4 per 1k)",
                    "queries": [source.url]
                });

                const { items } = await client.dataset(run.defaultDatasetId).listItems();
                if (items.length > 0) profileData = items[0];
            } catch (e: any) {
                console.error("Apify execution failed:", e);
                throw new Error("LinkedIn Scraper failed: " + e.message);
            }
        }

        if (!profileData) throw new Error("Failed to fetch LinkedIn data");

        // Normalize profile: ensure all common Apify/LinkedIn field names are merged so we never miss data
        const normalizedProfile = {
            ...profileData,
            experience: profileData.experience || profileData.experiences || profileData.positions || profileData.workExperience || [],
            education: profileData.education || profileData.schools || [],
            skills: profileData.skills || [],
            certifications: profileData.certifications || [],
            volunteering: profileData.volunteering || profileData.volunteer || [],
            honorsAndAwards: profileData.honorsAndAwards || profileData.awards || [],
            languages: profileData.languages || [],
            projects: profileData.projects || [],
        };

        const experienceCount = normalizedProfile.experience?.length || 0;
        const skillsCount = normalizedProfile.skills?.length || 0;
        const educationCount = normalizedProfile.education?.length || 0;

        console.log(`[LinkedIn Agent] Parsed Profile: ${profileData.publicIdentifier} (${profileData.fullName || profileData.firstName + ' ' + profileData.lastName})`);
        console.log(`[LinkedIn Agent] Raw Data: ${experienceCount} Experiences, ${skillsCount} Skills, ${educationCount} Education entries`);

        if (experienceCount === 0 && skillsCount === 0) {
            console.warn("[LinkedIn Agent] Warning: sparse profile data.");
        }

        // Build fallback patch from raw data so we never lose data (used if AI fails or returns sparse)
        const sourceId = `linkedin:${profileData.publicIdentifier || 'profile'}`;
        const rawPatch = rawLinkedInToPatch(normalizedProfile, sourceId);

        // 3. AI Extraction
        const userContent = JSON.stringify({
            job_intent: intent,
            linkedin_url: source.url,
            linkedin_data: {
                ...normalizedProfile,
                headline: profileData.headline,
                location: profileData.location || profileData.geoCountryName,
                publicIdentifier: profileData.publicIdentifier,
                contactInfo: profileData.contactInfo,
                profilePic: profileData.profilePic || profileData.profileImgURL || profileData.pictureUrl || profileData.photo,
            }
        });

        const result = await generateContent(SYSTEM_PROMPT, userContent);

        let patch: CareerProfilePatch;
        let learnings: ChatLearning;

        if (!result || !result.career_profile_patch) {
            console.warn("[LinkedIn Agent] AI returned no patch; using full raw data patch.");
            patch = rawPatch;
            learnings = { sourceType: "LinkedIn", title: "LinkedIn Profile", sections: [{ heading: "Profile imported", bullets: ["Data loaded from LinkedIn."] }] };
        } else {
            patch = result.career_profile_patch;
            patch.sourceId = sourceId;
            learnings = result.chat_learnings || { sourceType: "LinkedIn", title: "LinkedIn Analysis", sections: [] };

            // Merge in any missing entries from raw patch (AI sometimes drops items or dates)
            mergeFallbackPatch(patch, rawPatch);

            const imageUrl = profileData.profilePic || profileData.profileImgURL || profileData.pictureUrl || profileData.photo;
            if (imageUrl && !patch.personal) {
                patch.personal = { name: profileData.fullName || [profileData.firstName, profileData.lastName].filter(Boolean).join(' ') || '' };
            }
            if (imageUrl && patch.personal) {
                patch.personal.headshot = imageUrl;
            }
        }

        // SAFETY: Filter out generic "Project Name" entries
        if (patch.upsert_projects) {
            patch.upsert_projects = patch.upsert_projects.filter((p: any) => {
                const title = (p.name || '').trim().toLowerCase();
                return !["project name", "untitled", "new project", "project"].includes(title);
            });
        }

        console.log("[LinkedIn Agent] Final Patch:");
        console.log(`   - Roles: ${patch.upsert_roles?.length || 0}, Education: ${patch.upsert_education?.length || 0}, Skills: ${patch.upsert_skills?.length || 0}`);
        console.log(`   - Certs: ${patch.upsert_certifications?.length || 0}, Volunteer: ${patch.upsert_volunteering?.length || 0}, Awards: ${patch.upsert_awards?.length || 0}`);
        if (patch.upsert_roles?.[0]) {
            const r = patch.upsert_roles[0];
            console.log(`   - Sample role: ${r.title?.value} @ ${r.company?.value} (${r.startDate?.value || ''} - ${r.endDate?.value || ''})`);
        }

        return { patch, learnings };
    }
};
