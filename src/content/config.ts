import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.string().optional(),
    wpSlug: z.string().optional(),      // original WP URL slug (percent-encoded for Korean)
    lang: z.string().optional().default('en'),
    featuredImage: z.string().optional(), // local /assets/... path
    pairedSlug: z.string().optional(),    // decoded slug of EN/KO counterpart
    secondLang: z.string().optional(),    // if this post has embedded second language
    tags: z.array(z.string()).optional(), // topic tags
  }),
});

export const collections = { blog };
