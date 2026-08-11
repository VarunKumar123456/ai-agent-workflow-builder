'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { useAuthenticationStatus } from '@nhost/react';
import { gqlRequest } from '../lib/gql';

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
  refetchOrgs: () => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

const GET_MY_ORGS = `
  query GetMyOrgs {
    org_members {
      role
      organization { id name }
    }
  }
`;

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthenticationStatus();
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refetchOrgs = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    gqlRequest<{ org_members: OrgMembership[] }>(GET_MY_ORGS)
      .then((data) => {
        setMemberships(data.org_members ?? []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load orgs:', err);
        setLoading(false);
      });
  }, [isAuthenticated, tick]);

  useEffect(() => {
    if (!activeOrgId && memberships.length > 0) {
      setActiveOrgId(memberships[0].organization.id);
    }
  }, [memberships, activeOrgId]);

  const activeRole = memberships.find((m) => m.organization.id === activeOrgId)?.role ?? null;

  return (
    <OrgContext.Provider value={{ memberships, activeOrgId, setActiveOrgId, activeRole, loading, refetchOrgs }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
