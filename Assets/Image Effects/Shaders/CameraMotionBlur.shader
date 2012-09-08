 /*
 	motion blur image effect

	variation of simon green's implementation of "plausible motion blur"
	http://graphics.cs.williams.edu/papers/MotionBlurI3D12/

	and alex vlacho´s motion blur in
	http://www.valvesoftware.com/publications/2008/GDC2008_PostProcessingInTheOrangeBox.pdf

	TODO: add vignetting mask to hide blurring center objects in camera mode
	TODO: add support for dynamic and skinned objects
 */
 
 Shader "Hidden/CameraMotionBlur" {
	Properties {
		_MainTex ("-", 2D) = "" {}
		_NoiseTex ("-", 2D) = "black" {}
		_VelTex ("-", 2D) = "black" {}
	}

	CGINCLUDE
	
	#include "UnityCG.cginc"
	
	// noisiness
	#define JITTER_SCALE (0.25f)
	// 's' in paper (# of samples for reconstruction)
	#define NUM_SAMPLES (13)
	// # samples for valve style blur
	#define MOTION_SAMPLES (16)
	// 'k' in paper
	// (make sure to match this to MAX_RADIUS in script)	
	#define MAX_RADIUS (8)

	struct v2f {
		float4 pos : POSITION;
		float2 uv  : TEXCOORD0;
	};
				
	sampler2D _MainTex;
	sampler2D _CameraDepthTexture;
	sampler2D _VelTex;
	sampler2D _NeighbourMaxTex;
	sampler2D _NoiseTex;
	
	float4 _MainTex_TexelSize;
	float4 _CameraDepthTexture_TexelSize;
	float4 _VelTex_TexelSize;
	
	float4x4 _InvViewProj;	// inverse view-projection matrix
	float4x4 _PrevViewProj;	// previous view-projection matrix
	float4x4 _ToPrevViewProjCombined; // combined
	
	float _VelocityScale;
	float _DisplayVelocityScale;

	float _MaxVelocity;
	float _MinVelocity;
	
	float4 _VelBufferSize;
	float4 _TileBufferSize;

	float4 _BlurDirectionPacked;
	
	float _SoftZDistance;
	
	v2f vert( appdata_img v ) {
		v2f o;
		o.pos = mul (UNITY_MATRIX_MVP, v.vertex);
		o.uv = v.texcoord.xy;
		return o;
	}
	
	// calculate velocity for static scene from depth buffer			
	float4 CameraVelocity(v2f i) : COLOR
	{
		float2 depth_uv = i.uv;

		#if UNITY_UV_STARTS_AT_TOP
		if (_MainTex_TexelSize.y < 0)
			depth_uv.y = 1 - depth_uv.y;	
		#endif

		// read depth
		float d = tex2D (_CameraDepthTexture, depth_uv).x;
		
		// calculate world-space position of pixel from depth
		float3 clipPos = float3(i.uv, d)*2.0-1.0;
		
		//float4 worldPos = mul(_InvViewProj, float4(clipPos, 1.0));
		//worldPos.xyz /= worldPos.w;
		// calculate previous clip-space position using previous camera transform
		//float4 prevClipPos = mul(_PrevViewProj, float4(worldPos.xyz, 1.0));

		// only 1 matrix mul:
		float4 prevClipPos = mul(_ToPrevViewProjCombined, float4(clipPos, 1.0));
		prevClipPos.xyz /= prevClipPos.w;

		float3 clipVel = clipPos - prevClipPos.xyz;

		float2 prevScreenPos = prevClipPos.xy*0.5+0.5;	// [0, 1]
		float2 vel = (prevScreenPos - i.uv);

		vel *= _VelocityScale;

		// clamp to maximum velocity (in pixels)
		float velMag = length(vel*_MainTex_TexelSize.zw);
		if (velMag > _MaxVelocity) {
			vel *= (_MaxVelocity / velMag);
		}

		return float4(vel, 0.0, 1.0);
	}

	// returns vector with largest magnitude
	float2 vmax(float2 a, float2 b)
	{
		float ma = dot(a, a);
		float mb = dot(b, b);
		return (ma > mb) ? a : b;
	}

	// find dominant velocity in each tile
	float4 TileMax(v2f i) : COLOR
	{
		float2 max = float2(0.0, 0.0);
		float2 srcPos = (i.uv * _TileBufferSize.xy) * MAX_RADIUS;	// pixels
		srcPos *= _VelTex_TexelSize.xy;

		for(int y=0; y<MAX_RADIUS; y++) {
			for(int x=0; x<MAX_RADIUS; x++) {
				float2 v = tex2D(_MainTex, srcPos + float2(x,y) * _VelTex_TexelSize.xy).xy;
				max = vmax(max, v);
		  	}
  	  	}
  	  	return float4(max, 0, 1);
	}

	// find maximum velocity in any adjacent tile
	float4 NeighbourMax(v2f i) : COLOR
	{
		float2 max = float2(0.0, 0.0);
		for(int y=-1; y<=1; y++) {
			for(int x=-1; x<=1; x++) {
				float2 v = tex2D(_MainTex, i.uv + float2(x, y)*_TileBufferSize.zw).xy;
				max = vmax(max, v);
			}
		}
  	  	return float4(max, 0, 1);		
	}	
	 	 	
	float4 Debug(v2f i) : COLOR
	{
		return abs(tex2D(_MainTex, i.uv)) * _DisplayVelocityScale;		
	}

	// classification filters
	float cone(float2 x, float2 y, float2 v)
	{
		return clamp(1.0 - (length(x - y) / length(v)), 0.0, 1.0);
	}

	float cylinder(float2 x, float2 y, float2 v)
	{
		float lv = length(v);
		return 1.0 - smoothstep(0.95*lv, 1.05*lv, length(x - y));
	}

	// is zb closer than za?
	float softDepthCompare(float za, float zb)
	{
		return clamp(1.0 - (za - zb) / _SoftZDistance, 0.0, 1.0);
	}

	float4 SimpleBlur (v2f i) : COLOR
	{
		float2 x = i.uv;
		float2 xf = x;

		#if UNITY_UV_STARTS_AT_TOP
		if (_MainTex_TexelSize.y < 0)
    		xf.y = 1 - xf.y;
		#endif

		float2 vx = tex2D(_VelTex, xf).xy;	// vel at x

		// early exit for no blur
		float2 vxp = vx * _MainTex_TexelSize.zw;		// vel in pixels
		float velMag = length(vxp);

		float4 sum = float4(0, 0, 0, 0);
		for(int i=0; i<NUM_SAMPLES; i++) {
			float t = i / (float) (NUM_SAMPLES - 1);
			t = t-0.5;
			float2 y = x - vx*t;
			float4 cy = tex2D(_MainTex, y);
			sum += cy;
		}
		sum /= NUM_SAMPLES;		
		return sum;
	}
		
	// reconstruction based blur
	float4 ReconstructFilterBlur(v2f i) : COLOR
	{	
		float2 x = i.uv;
		float2 xf = x;

		#if UNITY_UV_STARTS_AT_TOP
		if (_MainTex_TexelSize.y < 0)
    		xf.y = 1 - xf.y;
		#endif
		
		// correct for sizes not multiple of _MaxRadius
		float2 x2 = xf *_VelBufferSize.xy / (_TileBufferSize.xy * (float)MAX_RADIUS);
		
		float2 vn = tex2D(_NeighbourMaxTex, x2).xy;	// largest velocity in neighbourhood
		float4 cx = tex2D(_MainTex, x);				// color at x

#if 0 // DISABLED FOR 3.0 complicance
		float2 vnp = vn*_MainTex_TexelSize.zw;		// vel in pixels
		float velMag = length(vnp);
		if (velMag < _MinVelocity) { 
			// no blur
			return cx;
		}
#endif

		float zx = tex2D (_CameraDepthTexture, x).x;
		zx = -Linear01Depth(zx);					// depth at x
		
		float2 vx = tex2D(_VelTex, xf).xy;			// vel at x 

		// random offset [-0.5, 0.5]
		int2 pixelCoord = i.uv * _MainTex_TexelSize.zw;	
		float j = tex2D(_NoiseTex, i.uv * 4.0f ).r * JITTER_SCALE;

		// sample current pixel
		//float weight = 1.0 / length(vx);
		float weight = 1.0;
		float4 sum = cx * weight;
 
		int centerSample = (int)(NUM_SAMPLES-1) / 2;
 
		// take S - 1 additional samples
		for(int i=0; i<NUM_SAMPLES; i++) { 
		
			float contrib = 1.0f;
		#if SHADER_API_D3D11
			if (i==centerSample) continue;	// skip center sample
		#else
			if (i==centerSample) contrib = 0.0f;	// skip center sample
		#endif

			// Choose evenly placed filter taps along +-vN,
			// but jitter the whole filter to prevent ghosting			

			float t = lerp(-1.0, 1.0, (i + j + 1.0) / (NUM_SAMPLES + 1.0));	// paper
			//float t = lerp(-0.5, 0.5, i / (float) (NUM_SAMPLES - 1)); // simon
			
			float2 y = x + vn*t; // + 0.5*_InvRenderTargetSize.xy;

			float2 yf = y;
			#if UNITY_UV_STARTS_AT_TOP
			if (_MainTex_TexelSize.y < 0)
	    		yf.y = 1 - yf.y;
			#endif
			// velocity at y 
			float2 vy = tex2D(_VelTex, float4(yf,0,0).xy).xy;

			// Fore- vs. background classification of Y relative to X
			float zy = tex2D (_CameraDepthTexture, float4(y,0,0).xy ).x; 
			zy = -Linear01Depth(zy);						
			
			float f = softDepthCompare(zx, zy);
			float b = softDepthCompare(zy, zx);
			float alphay = f * cone(y, x, vy) +	// blurry y in front of any x
			               b * cone(x, y, vx) +	// any y behing blurry x; estimate background
			               cylinder(y, x, vy) * cylinder(x, y, vx) * 2.0;	// simultaneous blurry x and y
			
			// accumulate sample 
			float4 cy = tex2D(_MainTex, float4(y,0,0).xy);
			sum += cy * alphay * contrib;
			weight += alphay * contrib;
		}
		sum /= weight;

		return sum;
	}


	float4 MotionVectorBlur (v2f i) : COLOR
	{
		float2 x = i.uv;

		float2 insideVector = (x*2-1) * float2(1,_MainTex_TexelSize.w/_MainTex_TexelSize.z);
		float2 rollVector = float2(insideVector.y, -insideVector.x);

		float2 blurDir = _BlurDirectionPacked.x * float2(0,1);
		blurDir += _BlurDirectionPacked.y * float2(1,0);
		blurDir += _BlurDirectionPacked.z * rollVector;
		blurDir += _BlurDirectionPacked.w * insideVector;
		blurDir *= _VelocityScale;
 
		// clamp to maximum velocity (in pixels)
		float velMag = length(blurDir);
		if (velMag > _MaxVelocity) {
			blurDir *= (_MaxVelocity / velMag);
			velMag = _MaxVelocity;
		} 

		float4 centerTap = tex2D(_MainTex, x);
		float4 sum = centerTap;

		blurDir *= smoothstep(_MinVelocity * 0.25f, _MinVelocity * 2.5, velMag);

		blurDir *= _MainTex_TexelSize.xy;
		blurDir /= MOTION_SAMPLES;

		for(int i=0; i<MOTION_SAMPLES; i++) {
			float4 tap = tex2D(_MainTex, x+i*blurDir);
			sum += tap;
		}

		return sum/(1+MOTION_SAMPLES);
	}
		 	 	  	 	  	 	  	 	 		 	 	  	 	  	 	  	 	 		 	 	  	 	  	 	  	 	 
	ENDCG
	
Subshader {
 
 // pass 0
 Pass {
	  ZTest Always Cull Off ZWrite On
	  Fog { Mode off }      

      CGPROGRAM
	  #pragma target 3.0
      #pragma vertex vert
      #pragma fragment CameraVelocity
      #pragma fragmentoption ARB_precision_hint_fastest
      #pragma glsl
      #pragma exclude_renderers d3d11_9x 

      ENDCG
  	}

 // pass 1
 Pass {
	  ZTest Always Cull Off ZWrite Off
	  Fog { Mode off }      

      CGPROGRAM
	  #pragma target 3.0
      #pragma vertex vert
      #pragma fragment Debug
      #pragma fragmentoption ARB_precision_hint_fastest
      #pragma glsl
      #pragma exclude_renderers d3d11_9x 

      ENDCG
  	}

 // pass 2
 Pass {
	  ZTest Always Cull Off ZWrite Off
	  Fog { Mode off }      

      CGPROGRAM
	  #pragma target 3.0
      #pragma vertex vert
      #pragma fragment TileMax
      #pragma fragmentoption ARB_precision_hint_fastest
      #pragma glsl
      #pragma exclude_renderers d3d11_9x       

      ENDCG
  	}

 // pass 3
 Pass {
	  ZTest Always Cull Off ZWrite Off
	  Fog { Mode off }      

      CGPROGRAM
	  #pragma target 3.0
      #pragma vertex vert
      #pragma fragment NeighbourMax
      #pragma fragmentoption ARB_precision_hint_fastest
      #pragma glsl
      #pragma exclude_renderers d3d11_9x       

      ENDCG
  	}

 // pass 4
 Pass {
	  ZTest Always Cull Off ZWrite Off
	  Fog { Mode off }      

      CGPROGRAM
	  #pragma target 3.0
      #pragma vertex vert 
      #pragma fragment ReconstructFilterBlur
      #pragma fragmentoption ARB_precision_hint_fastest
      #pragma glsl
      #pragma exclude_renderers d3d11_9x       

      ENDCG
  	}

 // pass 5
 Pass {
	  ZTest Always Cull Off ZWrite Off
	  Fog { Mode off }      
 
      CGPROGRAM
	  #pragma target 3.0
      #pragma vertex vert
      #pragma fragment SimpleBlur
      #pragma fragmentoption ARB_precision_hint_fastest
      #pragma glsl
      #pragma exclude_renderers d3d11_9x       

      ENDCG
  	}

  // pass 6
 Pass {
	  ZTest Always Cull Off ZWrite Off
	  Fog { Mode off }      
 
      CGPROGRAM
	  #pragma target 3.0
      #pragma vertex vert
      #pragma fragment MotionVectorBlur
      #pragma fragmentoption ARB_precision_hint_fastest
      #pragma glsl
      #pragma exclude_renderers d3d11_9x       

      ENDCG
  	}
  }
  
Fallback off

}