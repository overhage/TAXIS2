import { Navigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'


export default function PrivateRoute({ children }: { children: JSX.Element }) {
const { loading, authenticated } = useSession()
if (loading) return null // or a spinner
return authenticated ? children : <Navigate to="/login" replace />
}