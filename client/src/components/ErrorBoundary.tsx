import {Component,type ReactNode} from 'react';
export default class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main className="fc-recovery"><span>Farmconnect</span><h1>Let’s get you back to fresh.</h1><p>This screen could not load. Your saved orders are still on the server.</p><button onClick={()=>window.location.reload()}>Reload Farmconnect</button></main>:this.props.children;}
}
