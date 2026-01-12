-- =====================================================================================
--  Mendokoro / Yushoken Food Truck Survey — Supabase Schema
--
--  This schema defines a single 'submissions' table to store all survey results.
--  It uses a fully columnar approach (no JSON blobs) for easier querying and analysis.
-- =====================================================================================

--  Enable pgcrypto for gen_random_uuid() if not already enabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================================
--  Submissions Table
-- =====================================================================================
--  Drop the old table if it exists to start fresh.
DROP TABLE IF EXISTS public.submissions;

--  Create the main table to hold all survey submissions.
CREATE TABLE public.submissions (
    -- ---------------------------------------------------------------------------------
    --  METADATA
    --  Columns for tracking the submission itself.
    -- ---------------------------------------------------------------------------------
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'started' NOT NULL, -- e.g., 'started', 'completed'

    -- ---------------------------------------------------------------------------------
    --  GATE / CUSTOMER INFO
    --  Information collected from the initial screen before the survey begins.
    -- ---------------------------------------------------------------------------------
    receipt_number VARCHAR(25) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    name TEXT,
    phone VARCHAR(20),
    dpa_consent BOOLEAN NOT NULL DEFAULT false,
    promo_consent BOOLEAN DEFAULT false,

    -- ---------------------------------------------------------------------------------
    --  SURVEY ANSWERS
    --  Each column maps to a specific question in the survey.
    -- ---------------------------------------------------------------------------------

    -- Q1: Did you enjoy your Blue Truck Pop-up experience?
    q1_enjoy_experience TEXT, -- 'Yes' or 'No'
    q1_enjoy_experience_comment TEXT,

    -- Q2: Where did you hear about our Blue Truck Pop-up?
    q2_discovery_method TEXT,
    q2_discovery_method_other TEXT,

    -- Q3: Have you been to one of our branches before? (and follow-ups)
    q3_previous_visit TEXT, -- 'Yes' or 'No'
    q3a_brand_visited TEXT, -- 'Mendokoro Ramenba' or 'Ramen Yushoken'
    q3a_mendo_branch_visited TEXT,
    q3a_yusho_branch_visited TEXT,
    
    -- Q4: Where do you want to see our Blue Truck next?
    q4_next_location_type TEXT, -- 'City' or 'Mall'
    q4_next_location_city TEXT,
    q4_next_location_mall TEXT,

    -- Q5: Are you working near or living near here?
    q5_work_or_live_nearby TEXT, -- 'Working' or 'Living'
    q5_work_or_live_place TEXT,
    
    -- Q6: How much do you usually spend when dining out?
    q6_spend_amount TEXT,
    
    -- Q7: How would you rate our food?
    q7_rating_food SMALLINT, -- 1-10
    q7_rating_food_comment TEXT,
    q7_rating_food_comment_type TEXT, -- e.g., q7_food_low, q7_food_mid
    
    -- Q7: How would you rate our service?
    q7_rating_service SMALLINT, -- 1-10
    q7_rating_service_comment TEXT,
    q7_rating_service_comment_type TEXT,

    -- Q7: How would you rate the value for price?
    q7_rating_price SMALLINT, -- 1-10
    q7_rating_price_comment TEXT,
    q7_rating_price_comment_type TEXT,
    
    -- Q8: How likely is it that you would recommend this pop-up experience?
    q8_nps_recommend SMALLINT, -- 1-10
    q8_nps_recommend_comment TEXT,
    q8_nps_recommend_comment_type TEXT, -- e.g., q8_detractor, q8_promoter
    
    -- Q9: Which type of cuisine are you typically most interested in?
    q9_cuisine_interest TEXT[], -- Array of strings for multi-select
    q9_cuisine_interest_other TEXT,

    -- Q10: Based on your visit, when do you think you will dine with us again?
    q10_return_intention TEXT,
    q10_return_intention_other TEXT,

    -- Q10: Would you love to hear more about us and where we are headed?
    q10_follow_updates TEXT -- 'Yes' or 'No'
);

-- =====================================================================================
--  Row Level Security (RLS)
-- =====================================================================================
--  Enable RLS on the table.
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

--  Define policies for allowing the public API key (anon role) to interact with the table.
DROP POLICY IF EXISTS "Allow public insert" ON public.submissions;
CREATE POLICY "Allow public insert" ON public.submissions
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update" ON public.submissions;
CREATE POLICY "Allow public update" ON public.submissions
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- =====================================================================================
--  Indices
-- =====================================================================================
--  Add indices for frequently queried columns to improve performance.
CREATE INDEX IF NOT EXISTS submissions_email_idx ON public.submissions(email);
CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON public.submissions(created_at DESC);