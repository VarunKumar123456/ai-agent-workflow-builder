'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { useQuery } from '@apollo/client';
import { GET_MY_ORGS } from '../lib/graphql/operations';

interface OrgMembership {
  role: 'owner' | 'editor' | 'viewer';
  organization: { id: string; name: string };
}

interface OrgContextValue {
  memberships: OrgMembership[];
  activeOrgId: string | null;
  setActiveOrgId: (id: string) => void;
  activeRole: 'owner' | 'editor' | 'viewer' | null;
  loading: boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { data, loading } = useQuery(GET_MY_ORGS);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  const memberships: OrgMembership[] = data?.org_members ?? [];

  useEffect(() => {
    if (!activeOrgId && memberships.length > 0) {
      setActiveOrgId(memberships[0].organization.id);
    }
  }, [memberships, activeOrgId]);

  const activeRole = memberships.find((m) => m.organization.id === activeOrgId)?.role ?? null;

  return (
    <OrgContext.Provider value={{ memberships, activeOrgId, setActiveOrgId, activeRole, loading }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
