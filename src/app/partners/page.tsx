import { permanentRedirect } from "next/navigation";

// The partner program moved into My page (signed-in users only); keep old links working.
export default function PartnersPage() {
  permanentRedirect("/portfolio#partner");
}
