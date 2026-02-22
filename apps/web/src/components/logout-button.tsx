"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuthToken, getAuthToken } from "../lib/api";

export function LogoutButton() {
  const router = useRouter();
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(Boolean(getAuthToken()));
  }, []);

  if (!hasToken) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        clearAuthToken();
        router.push("/login");
      }}
    >
      Logout
    </button>
  );
}
