Shader "Hidden/Film Noise" {
	Properties {
		_MainTex ("Base", 2D) = "" {}
	}

	Subshader {
		Pass {
			Cull Off
			ZTest Always
			ZWrite Off
			Fog { Mode off }

			GLSLPROGRAM

			uniform sampler2D _MainTex;
			uniform sampler2D noise_tex;
			uniform vec4 uvmod;
			uniform lowp float intensity;

			varying mediump vec2 uv[2];

			#ifdef VERTEX
			void main() {
	            gl_Position = gl_ModelViewProjectionMatrix * gl_Vertex;
				uv[0] = gl_MultiTexCoord0.xy;
				uv[1] = gl_MultiTexCoord0.xy * uvmod.zw + uvmod.xy;
			}
			#endif

			#ifdef FRAGMENT
			void main() {
				lowp vec4 c0 = texture2D(_MainTex, uv[0]);
				lowp vec4 c1 = texture2D(noise_tex, uv[1]);
				c1 = (c1 * 2.0 - 1.0) * intensity;
				gl_FragColor = c0 + c1;
			}
			#endif

			ENDGLSL
		}
	}
}
