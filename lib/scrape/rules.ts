// Prompt rules shared by the Jev gate (lib/scrape/jev) and lead extraction
// (lib/scrape/firecrawl), so the two steps judge job posts and agencies the same way.

/** A business hiring for the very role the salesperson provides (a clinic hiring a
 *  receptionist, when the salesperson provides reception staff) shows the need the
 *  salesperson sells to. */
export const JOB_AD_RULE = "Job posts: a business's OWN job post for a role that the salesperson's product or service does or replaces counts as a buyer (the hiring need is the lead). The post must come from the hiring business itself. A person LOOKING FOR a job, asking where the jobs are or sharing job openings is a job seeker, never a buyer. Any other job post is not a buyer.";

/** VA, staffing and outsourcing agencies that recruit workers for their clients sell
 *  staff, so they are on the seller side when the salesperson provides staff or teams. */
export const AGENCY_RULE = "Agencies: when the salesperson provides staff, assistants, support teams or outsourced work, a VA, staffing, recruitment, outsourcing or BPO agency (including one posting job ads to recruit workers for its clients) is a seller and a competitor, never a buyer.";
